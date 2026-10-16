// Aprovação do cadastro de nutricionistas: quem se cadastra fica "em análise" até o responsável pelo NutriAli aprovar.
// O navegador não muda a situação do cadastro (as regras do banco não deixam): tudo passa por aqui, no servidor.
// Os avisos saem pelo Gmail que o responsável conectou no app; se não houver, a lista de aprovações continua valendo.
// O aviso leva um link assinado que abre o cadastro daquela pessoa já com "Aprovar" e "Recusar", sem pedir login.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { CFN_LOOKUP_URL, parseCrn } from './crn';
import { emailLayout, escapeHtml, getAccess, isValidEmail, p, sendMail } from './google-workspace';

export type Approval = 'approved' | 'pending' | 'rejected';

const PUBLIC_APP_URL = 'https://app.nutriali.cloud';
/** Se o aviso ao responsável falhar, uma nova tentativa só acontece depois deste tempo. */
const NOTIFY_RETRY_MS = 60 * 60 * 1000;

const approvalText = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Situação do cadastro. Contas de nutricionista criadas antes da aprovação existir (sem o campo) continuam aprovadas. */
export function approvalOf(profile: Record<string, unknown> | null | undefined): Approval {
  const value = profile?.approval;
  return value === 'pending' || value === 'rejected' ? value : 'approved';
}

/** E-mails de quem aprova os cadastros: variável ADMIN_EMAILS do servidor, separados por vírgula. */
export function adminEmails(raw: string | undefined = process.env.ADMIN_EMAILS): string[] {
  return (raw || '').split(/[,;\s]+/).map((email) => email.trim().toLowerCase()).filter((email) => isValidEmail(email));
}

/** Só aprova quem entrou com um e-mail da lista E teve esse e-mail confirmado (por exemplo, entrando com o Google). */
export function isAdmin(email: unknown, emailVerified: unknown, raw?: string): boolean {
  return emailVerified === true && typeof email === 'string' && adminEmails(raw).includes(email.toLowerCase());
}

export interface ApprovalRecord {
  uid: string;
  name: string;
  email: string;
  crn: string;
  specialty: string;
  phone: string;
  approval: Approval;
  requestedAt: string;
  decidedAt: string;
}

function toRecord(uid: string, profile: Record<string, unknown>): ApprovalRecord {
  return {
    uid,
    name: approvalText(profile.displayName, 120) || 'Nutricionista',
    email: approvalText(profile.email, 254),
    crn: approvalText(profile.crn, 40),
    specialty: approvalText(profile.specialty, 120),
    phone: approvalText(profile.phone, 40),
    approval: approvalOf(profile),
    requestedAt: approvalText(profile.approvalRequestedAt, 40) || approvalText(profile.createdAt, 40),
    decidedAt: approvalText(profile.approvalDecidedAt, 40),
  };
}

// ───────────── Link do e-mail de aviso ─────────────
// O link vale para UM cadastro e por 30 dias. Quem o tem pode ver os dados daquela pessoa e aprovar ou recusar:
// por isso só vai para a caixa de e-mail dos responsáveis. É assinado com um segredo do servidor (o mesmo
// AGENT_API_SECRET, com outro rótulo); sem o segredo configurado, o aviso sai sem o link direto.
const LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function linkSignature(payload: string): string | null {
  const secret = process.env.AGENT_API_SECRET;
  if (!secret || secret.length < 32) return null;
  return createHmac('sha256', secret).update('nutriali-approval-link:' + payload).digest('base64url');
}

/** Monta o código do link para o cadastro informado. Devolve null se o servidor não tiver o segredo. */
export function approvalLinkToken(uid: string, now = new Date()): string | null {
  const payload = uid + '.' + Math.floor((now.getTime() + LINK_TTL_MS) / 1000);
  const signature = linkSignature(payload);
  return signature ? Buffer.from(payload, 'utf8').toString('base64url') + '.' + signature : null;
}

export type LinkCheck = { ok: true; uid: string } | { ok: false; reason: 'invalid' | 'expired' };

/** Confere o código do link: assinatura e validade. */
export function readApprovalLink(token: unknown, now = new Date()): LinkCheck {
  if (typeof token !== 'string' || token.length > 400) return { ok: false, reason: 'invalid' };
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'invalid' };
  const payload = Buffer.from(parts[0], 'base64url').toString('utf8');
  const expected = linkSignature(payload);
  if (!expected) return { ok: false, reason: 'invalid' };
  const given = Buffer.from(parts[1]);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return { ok: false, reason: 'invalid' };
  const cut = payload.lastIndexOf('.');
  const uid = payload.slice(0, cut);
  const expires = Number(payload.slice(cut + 1));
  if (cut < 1 || !Number.isFinite(expires)) return { ok: false, reason: 'invalid' };
  return expires * 1000 < now.getTime() ? { ok: false, reason: 'expired' } : { ok: true, uid };
}

/** Gmail conectado de um dos responsáveis, para enviar os avisos. Sem nenhum conectado, devolve null. */
export async function adminSender(db: Firestore, preferred: string[] = []): Promise<{ token: string; email: string } | null> {
  for (const email of [...new Set([...preferred.map((item) => item.toLowerCase()), ...adminEmails()])]) {
    const found = await db.collection('users').where('email', '==', email).get();
    for (const doc of found.docs) {
      const access = await getAccess(db, doc.id);
      if (access.ok && isValidEmail(access.email)) return { token: access.token, email: access.email };
    }
  }
  return null;
}

const dataLine = (label: string, value: string) => (value ? p(`<strong>${label}:</strong> ${escapeHtml(value)}`) : '');
const button = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;margin:4px 8px 8px 0;padding:10px 16px;border-radius:10px;background:#276e58;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none">${label}</a>`;

// Teto de avisos por hora no app inteiro: uma enxurrada de cadastros falsos não lota a caixa do responsável.
// Quem ficar sem aviso continua na lista de aprovações e é avisado na tentativa seguinte.
const MAX_NOTICES_PER_HOUR = 20;
const recentNotices: number[] = [];

function noticeAllowed(now: number): boolean {
  while (recentNotices.length && now - recentNotices[0] > 60 * 60 * 1000) recentNotices.shift();
  if (recentNotices.length >= MAX_NOTICES_PER_HOUR) return false;
  recentNotices.push(now);
  return true;
}

/** Avisa os responsáveis de que há um cadastro esperando. Devolve se pelo menos um e-mail saiu. */
async function notifyAdmins(db: Firestore, record: ApprovalRecord, now: Date): Promise<boolean> {
  const recipients = adminEmails();
  if (!recipients.length || !noticeAllowed(now.getTime())) return false;
  try {
    const sender = await adminSender(db);
    if (!sender) return false;
    // Com o link assinado, o botão abre o cadastro desta pessoa já com "Aprovar" e "Recusar", sem login.
    const token = approvalLinkToken(record.uid, now);
    const note = (text: string) => p('<span style="font-size:13px;color:#5b6f67">' + text + '</span>');
    const html = (to: string) => emailLayout('Cadastro de nutricionista aguardando aprovação', [
      p(`<strong>${escapeHtml(record.name)}</strong> se cadastrou como nutricionista no NutriAli e está aguardando a sua aprovação.`),
      dataLine('E-mail', record.email),
      dataLine('CRN informado', record.crn),
      dataLine('Especialidade', record.specialty),
      dataLine('Telefone', record.phone),
      p('Antes de aprovar, confira na consulta do Conselho Federal de Nutrição se o nome e o número da inscrição batem e se o registro está ativo.'),
      '<p style="margin:16px 0 0">'
        + (token ? button(PUBLIC_APP_URL + '/admin/aprovar#' + token, 'Ver cadastro e aprovar') : button(PUBLIC_APP_URL + '/admin/aprovacoes', 'Abrir aprovações'))
        + button(CFN_LOOKUP_URL, 'Conferir no CFN') + '</p>',
      token ? note('O primeiro botão abre o cadastro com as opções de aprovar ou recusar, sem precisar entrar no aplicativo. Não encaminhe este e-mail: quem tiver o botão consegue decidir este cadastro.') : '',
      note('Para ver todos os cadastros, entre no aplicativo com o Google usando ' + escapeHtml(to) + ' e abra "Aprovações" no menu.'),
    ].join(''), 'Aviso automático do NutriAli. Enquanto você não aprovar, a pessoa continua em análise: não acessa a área de nutricionista nem aparece para os pacientes.');
    let sent = false;
    for (const to of recipients) {
      try {
        await sendMail(sender.token, { fromName: 'NutriAli', fromEmail: sender.email, to, subject: `Nutricionista aguardando aprovação: ${record.name}`, html: html(to) });
        sent = true;
      } catch {
        console.error('Aprovação: falha ao enviar o aviso a um dos responsáveis.');
      }
    }
    return sent;
  } catch {
    console.error('Aprovação: falha ao avisar os responsáveis.');
    return false;
  }
}

export type SubmitResult =
  | { ok: true; approval: Approval; crn: string; notified: boolean }
  | { ok: false; status: number; error: string };

/**
 * A nutricionista em análise envia (ou corrige) os dados profissionais. O CRN é conferido no formato, o pedido fica
 * registrado e os responsáveis são avisados uma vez; se o aviso falhar, tenta de novo depois de uma hora.
 */
export async function submitApproval(db: Firestore, uid: string, input: unknown, now = new Date()): Promise<SubmitResult> {
  const ref = db.collection('users').doc(uid);
  const snap = await ref.get();
  const profile = snap.exists ? snap.data() || {} : null;
  if (!profile || profile.role !== 'nutritionist') return { ok: false, status: 403, error: 'Esta função é só para nutricionistas.' };
  const approval = approvalOf(profile);
  if (approval !== 'pending') return { ok: true, approval, crn: approvalText(profile.crn, 40), notified: false };

  const body = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const checked = parseCrn(body.crn !== undefined && body.crn !== '' ? body.crn : profile.crn);
  if (!checked.ok) return { ok: false, status: 422, error: checked.error };
  const specialty = approvalText(body.specialty, 120) || approvalText(profile.specialty, 120);
  const phone = approvalText(body.phone, 40) || approvalText(profile.phone, 40);
  if (!specialty) return { ok: false, status: 422, error: 'Informe a sua especialidade principal.' };
  if (!phone) return { ok: false, status: 422, error: 'Informe um telefone de contato.' };

  const changed = checked.crn !== profile.crn || specialty !== profile.specialty || phone !== profile.phone;
  const update: Record<string, unknown> = {
    crn: checked.crn, specialty, phone,
    approvalRequestedAt: typeof profile.approvalRequestedAt === 'string' ? profile.approvalRequestedAt : now.toISOString(),
  };
  // Dados corrigidos depois do primeiro aviso geram um aviso novo, para o responsável não aprovar pelo dado antigo.
  const lastTry = Date.parse(String(profile.approvalNotifyTriedAt || ''));
  const notifiedBefore = typeof profile.approvalNotifiedAt === 'string' && !changed;
  // Aviso antigo, enviado antes de existir o link direto: sai mais um, já com o botão de aprovar.
  const linkAvailable = approvalLinkToken(uid, now) !== null;
  const needsLink = notifiedBefore && linkAvailable && profile.approvalLinkSent !== true;
  const alreadyNotified = notifiedBefore && !needsLink;
  const shouldNotify = !alreadyNotified && (changed || needsLink || !(now.getTime() - lastTry < NOTIFY_RETRY_MS));
  let notified = alreadyNotified;
  if (shouldNotify) {
    update.approvalNotifyTriedAt = now.toISOString();
    notified = await notifyAdmins(db, toRecord(uid, { ...profile, ...update }), now);
    if (notified) {
      update.approvalNotifiedAt = now.toISOString();
      update.approvalLinkSent = linkAvailable;
    }
  }
  await ref.set(update, { merge: true });
  return { ok: true, approval: 'pending', crn: checked.crn, notified };
}

/** Cadastros que passaram pela aprovação: os que esperam vêm primeiro (os mais antigos no topo), depois os decididos. */
export async function listApprovals(db: Firestore): Promise<ApprovalRecord[]> {
  const snap = await db.collection('users').where('role', '==', 'nutritionist').get();
  const records = snap.docs
    .filter((doc) => typeof (doc.data() || {}).approval === 'string')
    .map((doc) => toRecord(doc.id, doc.data() || {}));
  const pending = records.filter((record) => record.approval === 'pending').sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  const decided = records.filter((record) => record.approval !== 'pending').sort((a, b) => b.decidedAt.localeCompare(a.decidedAt)).slice(0, 30);
  return [...pending, ...decided];
}

export type DecisionResult =
  | { ok: true; approval: Approval; emailed: boolean }
  | { ok: false; status: number; error: string };

/**
 * O responsável aprova ou recusa um cadastro. A decisão fica registrada com data e autor, e a nutricionista recebe
 * um e-mail (se houver Gmail conectado para enviar). Contas antigas, sem o campo de aprovação, não passam por aqui.
 */
export async function decideApproval(db: Firestore, adminEmail: string, uid: unknown, decision: unknown, now = new Date(), how = ''): Promise<DecisionResult> {
  if (typeof uid !== 'string' || !uid || uid.length > 128 || uid.includes('/')) return { ok: false, status: 422, error: 'Cadastro inválido.' };
  if (decision !== 'approve' && decision !== 'reject') return { ok: false, status: 422, error: 'Decisão inválida.' };
  const ref = db.collection('users').doc(uid);
  const snap = await ref.get();
  const profile = snap.exists ? snap.data() || {} : null;
  if (!profile || profile.role !== 'nutritionist' || typeof profile.approval !== 'string') {
    return { ok: false, status: 404, error: 'Cadastro não encontrado.' };
  }
  const approval: Approval = decision === 'approve' ? 'approved' : 'rejected';
  if (profile.approval === approval) return { ok: true, approval, emailed: false };
  const decidedBy = adminEmail.toLowerCase() + (how ? ' (' + how + ')' : '');
  await ref.set({ approval, approvalDecidedAt: now.toISOString(), approvalDecidedBy: decidedBy }, { merge: true });

  let emailed = false;
  const record = toRecord(uid, profile);
  if (isValidEmail(record.email)) {
    try {
      const sender = await adminSender(db, [adminEmail]);
      if (sender) {
        const firstName = record.name.split(' ')[0];
        await sendMail(sender.token, approval === 'approved' ? {
          fromName: 'NutriAli', fromEmail: sender.email, to: record.email,
          subject: 'Seu cadastro no NutriAli foi aprovado',
          html: emailLayout('Cadastro aprovado', [
            p(`Olá, ${escapeHtml(firstName)}! O seu cadastro como nutricionista no NutriAli foi aprovado.`),
            p('Você já pode entrar no aplicativo. Na primeira vez, um tour rápido mostra onde fica cada coisa.'),
            `<p style="margin:16px 0 0">${button(`${PUBLIC_APP_URL}/login`, 'Entrar no NutriAli')}</p>`,
          ].join(''), 'Mensagem do NutriAli sobre o seu cadastro.'),
        } : {
          fromName: 'NutriAli', fromEmail: sender.email, to: record.email,
          subject: 'Sobre o seu cadastro no NutriAli',
          html: emailLayout('Cadastro não aprovado', [
            p(`Olá, ${escapeHtml(firstName)}. Não conseguimos confirmar os dados profissionais do seu cadastro como nutricionista no NutriAli${record.crn ? ` (${escapeHtml(record.crn)})` : ''}.`),
            p('Se houve algum engano nos dados, responda a este e-mail que revemos o seu cadastro.'),
          ].join(''), 'Mensagem do NutriAli sobre o seu cadastro.'),
        });
        emailed = true;
      }
    } catch {
      console.error('Aprovação: falha ao avisar a nutricionista da decisão.');
    }
  }
  return { ok: true, approval, emailed };
}

export type LinkView =
  | { ok: true; record: ApprovalRecord }
  | { ok: false; status: number; error: string };

const LINK_ERRORS = {
  invalid: 'Este link não é válido. Abra o e-mail de aviso mais recente ou entre no aplicativo e abra "Aprovações".',
  expired: 'Este link venceu. Entre no aplicativo com o Google e abra "Aprovações" no menu.',
};

/** Cadastro apontado pelo link do e-mail, para a tela de aprovar mostrar os dados. */
export async function approvalByLink(db: Firestore, token: unknown, now = new Date()): Promise<LinkView> {
  const link = readApprovalLink(token, now);
  if (!link.ok) return { ok: false, status: link.reason === 'expired' ? 410 : 404, error: LINK_ERRORS[link.reason] };
  const snap = await db.collection('users').doc(link.uid).get();
  const profile = snap.exists ? snap.data() || {} : null;
  if (!profile || profile.role !== 'nutritionist' || typeof profile.approval !== 'string') {
    return { ok: false, status: 404, error: 'Este cadastro não foi encontrado.' };
  }
  return { ok: true, record: toRecord(link.uid, profile) };
}

/** Decisão tomada pelo link do e-mail: vale como a do responsável (o link só vai para a caixa dele). */
export async function decideByLink(db: Firestore, token: unknown, decision: unknown, now = new Date()): Promise<DecisionResult> {
  const link = readApprovalLink(token, now);
  if (!link.ok) return { ok: false, status: link.reason === 'expired' ? 410 : 404, error: LINK_ERRORS[link.reason] };
  return decideApproval(db, adminEmails()[0] || 'responsavel', link.uid, decision, now, 'link do e-mail');
}
