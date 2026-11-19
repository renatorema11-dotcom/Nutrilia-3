// Avisos por e-mail ao paciente, enviados pelo Gmail da nutricionista dele. Somente no servidor.
// Rodam junto dos lembretes de consulta (o n8n chama a cada 10 minutos). Três avisos:
//  - recado novo no chat que o paciente ainda não leu: espera 10 minutos (ele pode ler no app antes) e
//    manda no máximo um e-mail a cada 12 horas por conversa;
//  - plano alimentar novo aprovado pela nutricionista;
//  - pedido de consulta que a nutricionista encerrou sem marcar.
// O e-mail não leva dados de saúde nem o texto das mensagens: só o aviso e o convite para abrir o app.
// O paciente desliga os avisos em Configurações (users/{uid}.emailNotices = false).
import type { Firestore } from 'firebase-admin/firestore';
import { emailLayout, escapeHtml, getAccess, isValidEmail, loadSettings, p, sendMail } from './google-workspace';

const NOTICE_APP_URL = 'https://app.nutriali.cloud';
/** Estado dos avisos de cada paciente (o que já foi avisado). Fechado ao navegador pelas regras. */
const NOTICES_COLLECTION = 'patientNotices';
/** Só olha o que mudou nos últimos 2 dias: nada antigo vira e-mail de repente. */
const NOTICE_LOOKBACK_MS = 2 * 86_400_000;
const CHAT_GRACE_MS = 10 * 60_000;
const CHAT_REPEAT_MS = 12 * 3_600_000;

export interface NoticeStats { checked: number; sent: number; skipped: number; failed: number }

type Outcome = 'sent' | 'skipped' | 'failed';
interface NoticeNames { nutriName: string; firstName: string }

const noticeButton = (path: string, label: string) =>
  `<p style="margin:16px 0 0"><a href="${escapeHtml(NOTICE_APP_URL + path)}" style="display:inline-block;background:#4c8466;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold">${escapeHtml(label)}</a></p>`;

const noticeFooter = (nutriName: string) =>
  `Você recebe este aviso porque é acompanhado(a) por ${escapeHtml(nutriName)} no NutriAli. Para não receber mais avisos por e-mail, desligue em Configurações, no aplicativo.`;

const hello = (firstName: string) => p(`Olá${firstName ? `, ${escapeHtml(firstName)}` : ''}!`);

/** Envia os avisos que estão na hora. Devolve só contagens: nenhum dado de paciente sai daqui. */
export async function runPatientNotices(db: Firestore, now = new Date()): Promise<NoticeStats> {
  const stats: NoticeStats = { checked: 0, sent: 0, skipped: 0, failed: 0 };
  const since = new Date(now.getTime() - NOTICE_LOOKBACK_MS);
  const sinceIso = since.toISOString();

  // Leituras repetidas na mesma rodada (paciente, perfil, conexão do Google, nome da nutricionista) vêm do cache.
  const cache = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    if (!cache.has(key)) cache.set(key, load());
    return cache.get(key) as Promise<T>;
  };
  const docData = (col: string, id: string) => once(`${col}/${id}`, async () => {
    const snap = await db.collection(col).doc(id).get();
    return snap.exists ? (snap.data() || {}) as Record<string, any> : null;
  });
  const states = new Map<string, Record<string, unknown>>();
  const stateOf = async (patientUid: string) => {
    if (!states.has(patientUid)) states.set(patientUid, { ...((await docData(NOTICES_COLLECTION, patientUid)) || {}) });
    return states.get(patientUid) as Record<string, any>;
  };
  const changed = new Set<string>();

  const deliver = async (patientUid: string, nutritionistId: string, compose: (names: NoticeNames) => { subject: string; html: string }): Promise<Outcome> => {
    const patient = await docData('patients', patientUid);
    // O vínculo que vale é o atual: aviso de quem não é mais paciente dessa nutricionista não sai.
    if (!patient || patient.nutritionistId !== nutritionistId || !isValidEmail(patient.email)) return 'skipped';
    const profile = await docData('users', patientUid);
    if (profile && profile.emailNotices === false) return 'skipped';
    const access = await once(`access/${nutritionistId}`, () => getAccess(db, nutritionistId));
    // Sem Google conectado não há como enviar; Google fora do ar só por agora: tenta na próxima rodada.
    if (!access.ok) return access.reason === 'unavailable' ? 'failed' : 'skipped';
    const settings = await once(`settings/${nutritionistId}`, () => loadSettings(db, nutritionistId));
    const nutriName = settings.displayName || 'Sua nutricionista';
    const firstName = typeof patient.name === 'string' ? patient.name.trim().split(/\s+/)[0] || '' : '';
    const { subject, html } = compose({ nutriName, firstName });
    try {
      await sendMail(access.token, { fromName: nutriName, fromEmail: access.email, to: patient.email, subject, html });
      return 'sent';
    } catch {
      return 'failed';
    }
  };
  const count = (outcome: Outcome) => { stats[outcome]++; };

  // 1) Pedido de consulta encerrado sem marcar (os confirmados já recebem a confirmação da consulta).
  const requests = await db.collection('appointmentRequests').where('answeredAt', '>=', sinceIso).get();
  for (const doc of requests.docs) {
    const r = doc.data() || {};
    if (r.status !== 'declined' || r.patientNotifiedAt || typeof r.patientUid !== 'string' || typeof r.nutritionistId !== 'string') continue;
    stats.checked++;
    const preferred = typeof r.preferredDate === 'string' && r.preferredDate !== 'a combinar' ? r.preferredDate.slice(0, 100) : '';
    const outcome = await deliver(r.patientUid, r.nutritionistId, ({ nutriName, firstName }) => ({
      subject: 'Resposta ao seu pedido de consulta',
      html: emailLayout('Resposta ao seu pedido de consulta', [
        hello(firstName),
        p(`${escapeHtml(nutriName)} viu o seu pedido de consulta${preferred ? ` (${escapeHtml(preferred)})` : ''} e não conseguiu marcar nesse horário.`),
        p(r.declineMessage ? 'Tem um recado para você no chat do aplicativo.' : 'Se quiser, peça outro horário pela Ali ou fale com a sua nutricionista pelo chat do aplicativo.'),
        noticeButton(r.declineMessage ? '/patient/chat?tab=nutritionist' : '/patient', r.declineMessage ? 'Abrir o chat' : 'Abrir o NutriAli'),
      ].join(''), noticeFooter(nutriName)),
    }));
    count(outcome);
    if (outcome === 'failed') continue; // tenta de novo na próxima rodada
    await doc.ref.set({ patientNotifiedAt: now.toISOString() }, { merge: true });
    // O recado que veio junto já foi avisado aqui: o aviso de chat não repete.
    if (outcome === 'sent' && r.declineMessage) {
      const state = await stateOf(r.patientUid);
      state.chatNotifiedUpTo = now.toISOString();
      changed.add(r.patientUid);
    }
  }

  // 2) Plano alimentar novo aprovado (a tela grava planApprovedAt ao aprovar).
  const plans = await db.collection('patients').where('planApprovedAt', '>=', sinceIso).get();
  for (const doc of plans.docs) {
    const d = doc.data() || {};
    if (d.currentPlan?.status !== 'approved' || typeof d.nutritionistId !== 'string') continue;
    const state = await stateOf(doc.id);
    if (typeof state.planNotifiedAt === 'string' && state.planNotifiedAt >= d.planApprovedAt) continue;
    stats.checked++;
    const outcome = await deliver(doc.id, d.nutritionistId, ({ nutriName, firstName }) => ({
      subject: 'Seu plano alimentar foi atualizado',
      html: emailLayout('Seu plano alimentar foi atualizado', [
        hello(firstName),
        p(`${escapeHtml(nutriName)} aprovou um plano alimentar novo para você. Ele já está no aplicativo, em Plano alimentar.`),
        noticeButton('/patient/plan', 'Ver o meu plano'),
      ].join(''), noticeFooter(nutriName)),
    }));
    count(outcome);
    if (outcome === 'failed') continue;
    state.planNotifiedAt = d.planApprovedAt;
    changed.add(doc.id);
  }

  // 3) Recado novo no chat que o paciente ainda não leu.
  const chats = await db.collection('chats').where('updatedAt', '>=', since).get();
  for (const chat of chats.docs) {
    const cut = chat.id.lastIndexOf('_');
    if (cut <= 0) continue;
    const patientUid = chat.id.slice(0, cut);
    const nutritionistId = chat.id.slice(cut + 1);
    const messages = await chat.ref.collection('messages').where('createdAt', '>=', sinceIso).get();
    const list = messages.docs.map((m) => m.data() || {}).filter((m) => typeof m.createdAt === 'string')
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const fromNutri = list.filter((m) => m.senderRole === 'nutritionist' && m.senderId === nutritionistId);
    if (!fromNutri.length) continue;
    const profile = await docData('users', patientUid);
    const state = await stateOf(patientUid);
    // Leu no app, respondeu ou já foi avisado: o que veio antes disso não conta como novo.
    const lastReply = list.filter((m) => m.senderRole === 'patient').map((m) => String(m.createdAt)).pop() || '';
    const seen = [typeof profile?.nutriChatReadAt === 'string' ? profile.nutriChatReadAt : '', lastReply,
      typeof state.chatNotifiedUpTo === 'string' ? state.chatNotifiedUpTo : ''].sort().pop() || '';
    const unread = fromNutri.filter((m) => String(m.createdAt) > seen);
    if (!unread.length) continue;
    if (now.getTime() - Date.parse(String(unread[0].createdAt)) < CHAT_GRACE_MS) continue;
    if (typeof state.chatNotifiedAt === 'string' && now.getTime() - Date.parse(state.chatNotifiedAt) < CHAT_REPEAT_MS) continue;
    stats.checked++;
    const outcome = await deliver(patientUid, nutritionistId, ({ nutriName, firstName }) => ({
      subject: `Nova mensagem de ${nutriName} no NutriAli`,
      html: emailLayout('Você tem mensagem nova', [
        hello(firstName),
        p(`${escapeHtml(nutriName)} te mandou ${unread.length === 1 ? 'uma mensagem' : `${unread.length} mensagens`} no chat do NutriAli. Para ler e responder, abra o aplicativo, em Chat, na aba Nutricionista.`),
        noticeButton('/patient/chat?tab=nutritionist', 'Abrir o chat'),
      ].join(''), noticeFooter(nutriName)),
    }));
    count(outcome);
    if (outcome === 'failed') continue;
    state.chatNotifiedUpTo = String(unread[unread.length - 1].createdAt);
    if (outcome === 'sent') state.chatNotifiedAt = now.toISOString();
    changed.add(patientUid);
  }

  await Promise.all([...changed].map((uid) => db.collection(NOTICES_COLLECTION).doc(uid)
    .set({ ...states.get(uid), updatedAt: now.toISOString() }, { merge: true })));
  return stats;
}
