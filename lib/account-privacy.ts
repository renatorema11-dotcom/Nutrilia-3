// Direitos da LGPD dentro do app. Somente no servidor.
//  - Baixar meus dados: o paciente recebe em um arquivo o que o app guarda sobre ele (sem as anotações que a
//    nutricionista faz das consultas, que ficam com ela).
//  - Pedido de exclusão: vira um pedido analisado pelo responsável pelo NutriAli (o prontuário pode ter prazo
//    de guarda). O responsável recebe um e-mail; a nutricionista do paciente também é avisada.
//  - O responsável decide na página /admin/exclusoes: apagar os dados de vez ou manter a conta.
import type { Firestore } from 'firebase-admin/firestore';
import { emailLayout, escapeHtml, getAccess, isValidEmail, p, sendMail } from './google-workspace';
import { adminEmails, adminSender } from './nutritionist-approval';
import { PRIVACY_CONTACT, PRIVACY_CONTROLLER, PRIVACY_VERSION } from './privacy';

export const DELETIONS_COLLECTION = 'deletionRequests';
const PRIVACY_APP_URL = 'https://app.nutriali.cloud';
const DELETION_REASON_MAX = 500;

type Data = Record<string, any>;

const dataOf = (snap: { exists: boolean; data: () => Data | undefined }) => (snap.exists ? snap.data() || {} : null);

// ───────────── Baixar meus dados ─────────────

/** Tudo o que o app guarda sobre o paciente, em um objeto só, para o arquivo "meus dados". */
export async function exportPatientData(db: Firestore, uid: string, now = new Date()): Promise<Data> {
  const [userSnap, patientSnap] = await Promise.all([db.collection('users').doc(uid).get(), db.collection('patients').doc(uid).get()]);
  const account = { ...(dataOf(userSnap) || {}) };
  // Campos internos da aprovação de nutricionistas não são dados do paciente.
  for (const key of Object.keys(account)) if (key.startsWith('approval')) delete account[key];
  const record = { ...(dataOf(patientSnap) || {}) };
  // Rascunhos de plano são trabalho da nutricionista ainda não liberado: só sai o plano aprovado.
  delete record.pendingPlan;
  delete record.planDraftJob;
  if (record.currentPlan && record.currentPlan.status !== 'approved') delete record.currentPlan;

  const ref = db.collection('patients').doc(uid);
  const nutritionistId = typeof record.nutritionistId === 'string' ? record.nutritionistId : '';
  const [logs, messages, requests, appointments] = await Promise.all([
    ref.collection('foodLogs').get(),
    nutritionistId ? db.collection('chats').doc(`${uid}_${nutritionistId}`).collection('messages').get() : Promise.resolve({ docs: [] as { data: () => Data }[] }),
    db.collection('appointmentRequests').where('patientUid', '==', uid).get(),
    db.collection('aliAppointments').where('patientUid', '==', uid).get(),
  ]);
  const byDate = (field: string) => (a: Data, b: Data) => String(a[field] || '').localeCompare(String(b[field] || ''));
  return {
    sobreEsteArquivo: {
      geradoEm: now.toISOString(),
      responsavel: PRIVACY_CONTROLLER,
      contato: PRIVACY_CONTACT,
      politicaDePrivacidade: `${PRIVACY_APP_URL}/privacidade (versão ${PRIVACY_VERSION})`,
      observacao: 'Dados que o NutriAli guarda sobre você. As anotações que a nutricionista faz das consultas ficam com ela; peça diretamente a ela, se quiser.',
    },
    conta: account,
    prontuario: record,
    refeicoesRegistradas: logs.docs.map((doc) => doc.data() || {}).sort(byDate('loggedAt')),
    conversaComNutricionista: messages.docs.map((doc) => {
      const m = doc.data() || {};
      return { de: m.senderRole === 'patient' ? 'você' : m.senderName || 'nutricionista', texto: m.text, em: m.createdAt };
    }).sort(byDate('em')),
    pedidosDeConsulta: requests.docs.map((doc) => {
      const r = doc.data() || {};
      return { preferencia: r.preferredDate, observacao: r.notes || '', situacao: r.status, pedidoEm: r.createdAt, consultaMarcada: r.appointmentLabel || null };
    }).sort(byDate('pedidoEm')),
    consultas: appointments.docs.map((doc) => {
      const a = doc.data() || {};
      return { quando: a.label, inicio: a.startLocal, modo: a.mode, situacao: a.status === 'cancelled' ? 'cancelada' : 'marcada' };
    }).sort(byDate('inicio')),
  };
}

// ───────────── Pedido de exclusão ─────────────

export type DeletionState = 'pending' | 'deleted' | 'kept';

export interface DeletionView { status: DeletionState; requestedAt: string; decidedAt: string | null }

export interface DeletionRow extends DeletionView {
  uid: string; role: 'patient' | 'nutritionist'; name: string; email: string; nutritionistName: string; reason: string; decidedBy: string | null;
}

const viewOf = (d: Data): DeletionView => ({ status: d.status, requestedAt: String(d.requestedAt || ''), decidedAt: typeof d.decidedAt === 'string' ? d.decidedAt : null });

export async function deletionStatusOf(db: Firestore, uid: string): Promise<DeletionView | null> {
  const d = dataOf(await db.collection(DELETIONS_COLLECTION).doc(uid).get());
  return d && (d.status === 'pending' || d.status === 'deleted' || d.status === 'kept') ? viewOf(d) : null;
}

const privacyButton = (href: string, label: string) =>
  `<p style="margin:16px 0 0"><a href="${escapeHtml(href)}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#276e58;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none">${escapeHtml(label)}</a></p>`;
const privacyLine = (label: string, value: string) => (value ? p(`<strong>${label}:</strong> ${escapeHtml(value)}`) : '');

export type DeletionRequestResult = { ok: true; deletion: DeletionView; adminNotified: boolean } | { ok: false; status: number; error: string };

/** Registra o pedido de exclusão da própria conta e avisa o responsável (e a nutricionista, se for paciente). */
export async function requestDeletion(db: Firestore, uid: string, profile: Data | null, reasonInput: unknown, now = new Date()): Promise<DeletionRequestResult> {
  if (!profile || (profile.role !== 'patient' && profile.role !== 'nutritionist')) return { ok: false, status: 403, error: 'Conta não encontrada.' };
  const ref = db.collection(DELETIONS_COLLECTION).doc(uid);
  const current = dataOf(await ref.get());
  if (current && current.status === 'pending') return { ok: true, deletion: viewOf(current), adminNotified: false };

  const role = profile.role as 'patient' | 'nutritionist';
  const patient = role === 'patient' ? dataOf(await db.collection('patients').doc(uid).get()) : null;
  const nutritionistId = patient && typeof patient.nutritionistId === 'string' ? patient.nutritionistId : '';
  const name = String(profile.displayName || patient?.name || '').slice(0, 120);
  const email = isValidEmail(profile.email) ? profile.email : '';
  const reason = typeof reasonInput === 'string' ? reasonInput.trim().slice(0, DELETION_REASON_MAX) : '';
  const nutritionistName = patient && typeof patient.nutritionistName === 'string' ? patient.nutritionistName : '';
  const request = { uid, role, name, email, nutritionistId: nutritionistId || null, nutritionistName, reason, status: 'pending', requestedAt: now.toISOString() };
  await ref.set(request);

  const kind = role === 'patient' ? 'paciente' : 'nutricionista';
  let adminNotified = false;
  try {
    const sender = await adminSender(db);
    if (sender) {
      for (const to of adminEmails()) {
        try {
          await sendMail(sender.token, {
            fromName: 'NutriAli', fromEmail: sender.email, to,
            subject: `Pedido de exclusão de conta: ${name || email || kind}`,
            html: emailLayout('Pedido de exclusão de conta', [
              p(`Uma conta de <strong>${kind}</strong> pediu a exclusão dos dados no NutriAli. Pela LGPD, o pedido precisa de resposta em até 15 dias.`),
              privacyLine('Nome', name), privacyLine('E-mail', email),
              privacyLine('Nutricionista responsável', nutritionistName), privacyLine('Motivo informado', reason),
              p(role === 'patient'
                ? 'Antes de apagar, confirme com a nutricionista se o prontuário precisa ser guardado por algum prazo profissional. Ela também recebeu um aviso.'
                : 'Conta de nutricionista: combine com ela o que fazer com os pacientes antes de resolver o pedido.'),
              privacyButton(`${PRIVACY_APP_URL}/admin/exclusoes`, 'Ver pedidos de exclusão'),
              p(`<span style="font-size:13px;color:#5b6f67">Para abrir a página, entre no aplicativo com o Google usando ${escapeHtml(to)}.</span>`),
            ].join(''), 'Aviso automático do NutriAli.'),
          });
          adminNotified = true;
        } catch {
          console.error('Exclusão: falha ao avisar um dos responsáveis.');
        }
      }
    }
  } catch {
    console.error('Exclusão: falha ao avisar os responsáveis.');
  }
  if (nutritionistId) {
    // A nutricionista recebe pelo próprio Gmail, para ela mesma (o paciente não vê esse e-mail).
    try {
      const access = await getAccess(db, nutritionistId);
      if (access.ok && isValidEmail(access.email)) {
        await sendMail(access.token, {
          fromName: 'NutriAli', fromEmail: access.email, to: access.email,
          subject: `Pedido de exclusão de dados: ${name || 'paciente'}`,
          html: emailLayout('Um paciente pediu a exclusão dos dados', [
            p(`<strong>${escapeHtml(name || 'Um paciente seu')}</strong> pediu a exclusão da conta e dos dados no NutriAli.`),
            p(`O responsável pelo NutriAli vai analisar o pedido. Se você precisa guardar o prontuário por algum prazo profissional, escreva para ${escapeHtml(PRIVACY_CONTACT)} antes que os dados sejam apagados.`),
          ].join(''), 'Aviso automático do NutriAli.'),
        });
      }
    } catch {
      console.error('Exclusão: falha ao avisar a nutricionista.');
    }
  }
  return { ok: true, deletion: viewOf(request), adminNotified };
}

export async function listDeletionRequests(db: Firestore): Promise<DeletionRow[]> {
  // Poucos pedidos: lê todos e ordena aqui (os esperando decisão primeiro).
  const snap = await db.collection(DELETIONS_COLLECTION).get();
  return snap.docs.filter((doc) => ['pending', 'deleted', 'kept'].includes((doc.data() || {}).status)).map((doc) => {
    const d = doc.data() || {};
    return {
      ...viewOf(d), uid: doc.id, role: d.role === 'nutritionist' ? 'nutritionist' as const : 'patient' as const,
      name: String(d.name || ''), email: String(d.email || ''), nutritionistName: String(d.nutritionistName || ''), reason: String(d.reason || ''),
      decidedBy: typeof d.decidedBy === 'string' ? d.decidedBy : null,
    };
  }).sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || b.requestedAt.localeCompare(a.requestedAt)).slice(0, 100);
}

/** Apaga o login da pessoa (na rota: Firebase Auth). Login que já não existe não é erro. */
export type DeleteLogin = (uid: string) => Promise<void>;

async function deleteDocs(docs: { ref: { delete: () => Promise<unknown> } }[]) {
  for (const doc of docs) await doc.ref.delete();
}

/** Apaga de vez os dados de um paciente: prontuário, refeições, conversa, pedidos, consultas, anotações, avisos e o login. */
async function erasePatient(db: Firestore, uid: string, nutritionistId: string, deleteLogin: DeleteLogin) {
  const patientRef = db.collection('patients').doc(uid);
  await deleteDocs((await patientRef.collection('foodLogs').get()).docs);
  if (nutritionistId) {
    const chat = db.collection('chats').doc(`${uid}_${nutritionistId}`);
    await deleteDocs((await chat.collection('messages').get()).docs);
    await chat.delete();
  }
  for (const col of ['appointmentRequests', 'aliAppointments', 'consultationNotes']) {
    await deleteDocs((await db.collection(col).where('patientUid', '==', uid).get()).docs);
  }
  // O registro de uso da Ali fica (só contagens), mas sem apontar para a pessoa.
  for (const doc of (await db.collection('aiActions').where('patientUid', '==', uid).get()).docs) await doc.ref.set({ patientUid: null }, { merge: true });
  await db.collection('patientNotices').doc(uid).delete();
  await patientRef.delete();
  await db.collection('users').doc(uid).delete();
  await deleteLogin(uid);
}

export type DeletionDecision = { ok: true; status: DeletionState } | { ok: false; status: number; error: string };

/** O responsável decide: 'delete' apaga os dados de vez (contas de paciente); 'keep' mantém a conta. */
export async function decideDeletion(db: Firestore, adminEmail: string, uid: unknown, decision: unknown, deleteLogin: DeleteLogin, now = new Date()): Promise<DeletionDecision> {
  if (typeof uid !== 'string' || !uid || uid.length > 128 || uid.includes('/')) return { ok: false, status: 400, error: 'Pedido inválido.' };
  if (decision !== 'delete' && decision !== 'keep') return { ok: false, status: 400, error: 'Escolha apagar os dados ou manter a conta.' };
  const ref = db.collection(DELETIONS_COLLECTION).doc(uid);
  const request = dataOf(await ref.get());
  if (!request || request.status !== 'pending') return { ok: false, status: 409, error: 'Este pedido não está mais esperando decisão.' };
  if (decision === 'delete' && request.role !== 'patient') {
    return { ok: false, status: 409, error: 'Conta de nutricionista: ainda não dá para apagar por aqui. Combine com ela o que fazer com os pacientes e marque como mantida.' };
  }
  if (decision === 'delete') await erasePatient(db, uid, typeof request.nutritionistId === 'string' ? request.nutritionistId : '', deleteLogin);
  // Depois de apagar, o pedido guarda só o necessário para provar que foi atendido (sem nome, e-mail nem motivo).
  const decided = { status: decision === 'delete' ? 'deleted' : 'kept', decidedAt: now.toISOString(), decidedBy: adminEmail };
  await ref.set(decision === 'delete' ? { uid, role: request.role, requestedAt: request.requestedAt, ...decided } : { ...request, ...decided });
  return { ok: true, status: decided.status as DeletionState };
}
