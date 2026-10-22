// Aviso de erros do servidor: cada falha que antes só ia para o registro do servidor fica guardada no banco
// (coleção serverAlerts, fechada ao navegador pelas regras padrão) e avisa o responsável pelo NutriAli por e-mail.
// O aviso diz só onde falhou, quantas vezes e o código técnico; nunca leva a mensagem do erro nem dados de pacientes.
// Para não lotar a caixa: no máximo um e-mail por tipo de erro a cada 6 horas e 12 por dia no app inteiro.
import { createHash } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { getAdminDb } from './firebase-admin';
import { emailLayout, escapeHtml, p, sendMail } from './google-workspace';
import { adminEmails, adminSender } from './nutritionist-approval';

export const ALERTS_COLLECTION = 'serverAlerts';
const ALERTS_APP_URL = 'https://app.nutriali.cloud';
/** Depois de um aviso, o mesmo erro só gera outro e-mail depois deste tempo (com a contagem do período). */
const REPEAT_MS = 6 * 60 * 60 * 1000;
const MAX_EMAILS_PER_DAY = 12;
/** O mesmo erro repetido em menos de um minuto só soma na contagem: o banco não é consultado a cada repetição. */
const MEMORY_GAP_MS = 60 * 1000;

const alertText = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const isoOf = (value: unknown) => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : '');

export function alertId(label: string): string {
  return createHash('sha256').update(label, 'utf8').digest('hex').slice(0, 24);
}

/** Só o código técnico do erro (como "auth/user-not-found", 503 ou "TypeError"); a mensagem fica de fora. */
export function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const { code, status, name } = error as { code?: unknown; status?: unknown; name?: unknown };
  for (const value of [code, status]) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'string' && /^[\w./-]{1,60}$/.test(value)) return value;
  }
  return typeof name === 'string' && /^[A-Za-z]{1,40}$/.test(name) ? name : '';
}

const alertWhen = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function alertEmail(label: string, times: number, code: string, firstAt: string, lastAt: string, to: string): string {
  const note = (text: string) => p('<span style="font-size:13px;color:#5b6f67">' + text + '</span>');
  return emailLayout('Erro no servidor do NutriAli', [
    p('O aplicativo registrou uma falha:'),
    p(`<strong>${escapeHtml(label)}</strong>`),
    p(times > 1 ? `Aconteceu <strong>${times} vezes</strong> desde o último aviso, a mais recente em ${alertWhen(lastAt)}.` : `Aconteceu em ${alertWhen(lastAt)}.`),
    firstAt !== lastAt ? p(`Primeira vez registrada: ${alertWhen(firstAt)}.`) : '',
    code ? p(`<strong>Código técnico:</strong> ${escapeHtml(code)}`) : '',
    '<p style="margin:16px 0 0"><a href="' + ALERTS_APP_URL + '/admin/erros" style="display:inline-block;margin:4px 8px 8px 0;padding:10px 16px;border-radius:10px;background:#276e58;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none">Ver erros do servidor</a></p>',
    note('Se o erro continuar ou atrapalhar quem usa o app, mostre este e-mail a quem cuida do aplicativo. Este aviso não leva dados de pacientes.'),
    note('Para ver a lista, entre no aplicativo com o Google usando ' + escapeHtml(to) + '.'),
  ].join(''), `Aviso automático do NutriAli. Você recebe no máximo um aviso de cada tipo de erro a cada 6 horas.`);
}

/** Reserva um dos e-mails do dia. Devolve false quando o teto diário já foi atingido. */
async function takeEmailSlot(db: Firestore, now: Date): Promise<boolean> {
  const ref = db.collection('serverAlertsMeta').doc('limite');
  const snap = await ref.get();
  const data = snap.exists ? snap.data() || {} : {};
  const day = now.toISOString().slice(0, 10);
  const sent = data.day === day && typeof data.sent === 'number' ? data.sent : 0;
  if (sent >= MAX_EMAILS_PER_DAY) return false;
  await ref.set({ day, sent: sent + 1 });
  return true;
}

export interface HandledError { id: string; times: number; emailed: number }

/**
 * Registra uma ocorrência (mais as repetições somadas na memória) e, se for a hora, avisa os responsáveis.
 * Sem Gmail de responsável conectado, o erro fica só registrado e o aviso sai na próxima vez que der.
 */
export async function handleServerError(db: Firestore, rawLabel: string, code: string, now = new Date(), extra = 0): Promise<HandledError | null> {
  const label = alertText(rawLabel, 160);
  if (!label) return null;
  const id = alertId(label);
  const ref = db.collection(ALERTS_COLLECTION).doc(id);
  const snap = await ref.get();
  const prev = snap.exists ? snap.data() || {} : {};
  const times = 1 + Math.max(0, Math.floor(extra));
  const pending = (typeof prev.pending === 'number' ? prev.pending : 0) + times;
  const nowIso = now.toISOString();
  const firstAt = isoOf(prev.firstAt) || nowIso;
  const notifiedAt = isoOf(prev.notifiedAt);
  const resolvedAt = isoOf(prev.resolvedAt);
  const record = {
    label, code: code || alertText(prev.code, 60), count: (typeof prev.count === 'number' ? prev.count : 0) + times,
    firstAt, lastAt: nowIso, notifiedAt: notifiedAt || null, resolvedAt: resolvedAt || null,
  };
  // Erro novo, que voltou depois de marcado como resolvido, ou que continua depois de 6 horas do último aviso.
  const due = !notifiedAt || (!!resolvedAt && resolvedAt >= notifiedAt) || now.getTime() - Date.parse(notifiedAt) >= REPEAT_MS;
  const recipients = adminEmails();
  const sender = due && recipients.length ? await adminSender(db) : null;
  if (!sender || !(await takeEmailSlot(db, now))) {
    await ref.set({ ...record, pending });
    return { id, times, emailed: 0 };
  }
  await ref.set({ ...record, pending: 0, notifiedAt: nowIso });
  let emailed = 0;
  for (const to of recipients) {
    try {
      await sendMail(sender.token, { fromName: 'NutriAli', fromEmail: sender.email, to, subject: `Erro no servidor do NutriAli: ${label}`, html: alertEmail(label, pending, record.code, firstAt, nowIso, to) });
      emailed++;
    } catch {
      // Sem reportServerError aqui: um Gmail fora do ar não pode gerar outro aviso de erro.
      console.error('Aviso de erro: o e-mail ao responsável não saiu.');
    }
  }
  return { id, times, emailed };
}

const recentAlerts = new Map<string, { at: number; skipped: number }>();

/** Guarda o erro e avisa o responsável, sem esperar e sem nunca lançar erro (quem chamou segue normalmente). */
export function notifyServerError(label: string, error?: unknown): void {
  const clean = alertText(label, 160);
  if (!clean) return;
  const now = Date.now();
  const seen = recentAlerts.get(clean);
  if (seen && now - seen.at < MEMORY_GAP_MS) {
    seen.skipped++;
    return;
  }
  recentAlerts.set(clean, { at: now, skipped: 0 });
  if (recentAlerts.size > 300) recentAlerts.delete(recentAlerts.keys().next().value as string);
  let db: Firestore;
  try {
    db = getAdminDb();
  } catch {
    return;
  }
  handleServerError(db, clean, errorCode(error), new Date(now), seen ? seen.skipped : 0)
    .catch(() => console.error('Aviso de erro: falha ao registrar a ocorrência.'));
}

/** Escreve a falha no registro do servidor (como antes) e avisa o responsável. Use frases fixas, sem dados de pessoas. */
export function reportServerError(label: string, error?: unknown): void {
  console.error(label);
  notifyServerError(label, error);
}

// ───────────── Tela do responsável (/admin/erros) ─────────────

export interface AlertRow {
  id: string;
  label: string;
  code: string;
  count: number;
  pending: number;
  firstAt: string;
  lastAt: string;
  notifiedAt: string | null;
  resolvedAt: string | null;
  open: boolean;
}

/** Erros registrados: os em aberto primeiro, do mais recente para o mais antigo. */
export async function listServerAlerts(db: Firestore): Promise<AlertRow[]> {
  const snap = await db.collection(ALERTS_COLLECTION).get();
  const rows = snap.docs.map((doc) => {
    const d = doc.data() || {};
    const lastAt = isoOf(d.lastAt);
    const resolvedAt = isoOf(d.resolvedAt) || null;
    return {
      id: doc.id, label: alertText(d.label, 160), code: alertText(d.code, 60), count: typeof d.count === 'number' ? d.count : 0,
      pending: typeof d.pending === 'number' ? d.pending : 0, firstAt: isoOf(d.firstAt), lastAt, notifiedAt: isoOf(d.notifiedAt) || null,
      resolvedAt, open: !resolvedAt || lastAt > resolvedAt,
    };
  });
  return rows.sort((a, b) => Number(b.open) - Number(a.open) || b.lastAt.localeCompare(a.lastAt)).slice(0, 100);
}

export type AlertResult = { ok: true } | { ok: false; status: number; error: string };

/** Marca o erro como resolvido. Se acontecer de novo, volta para a lista em aberto e gera um aviso na hora. */
export async function resolveServerAlert(db: Firestore, id: unknown, now = new Date()): Promise<AlertResult> {
  if (typeof id !== 'string' || !/^[0-9a-f]{24}$/.test(id)) return { ok: false, status: 400, error: 'Erro não encontrado.' };
  const ref = db.collection(ALERTS_COLLECTION).doc(id);
  if (!(await ref.get()).exists) return { ok: false, status: 404, error: 'Erro não encontrado.' };
  await ref.update({ resolvedAt: now.toISOString(), pending: 0 });
  return { ok: true };
}

/** Se os avisos têm por onde sair: algum responsável com o Gmail conectado no app. */
export async function alertEmailStatus(db: Firestore): Promise<{ ready: boolean; recipients: number }> {
  const recipients = adminEmails().length;
  return { ready: recipients > 0 && !!(await adminSender(db)), recipients };
}

/** E-mail de teste para os responsáveis, para conferir que os avisos chegam. */
export async function sendTestAlert(db: Firestore, now = new Date()): Promise<{ ok: true; sent: number } | { ok: false; status: number; error: string }> {
  const recipients = adminEmails();
  const sender = recipients.length ? await adminSender(db) : null;
  if (!sender) {
    return { ok: false, status: 409, error: 'Nenhum responsável está com o Google conectado no app. Conecte o Google na sua conta de nutricionista (Configurações da Ali) e tente de novo.' };
  }
  let sent = 0;
  for (const to of recipients) {
    try {
      await sendMail(sender.token, {
        fromName: 'NutriAli', fromEmail: sender.email, to, subject: 'Teste do aviso de erros do NutriAli',
        html: emailLayout('Teste do aviso de erros', [
          p('Este é um e-mail de teste. Os avisos de erro do servidor do NutriAli vão chegar assim, nesta caixa.'),
          p(`Enviado em ${alertWhen(now.toISOString())}.`),
        ].join(''), 'Aviso automático do NutriAli.'),
      });
      sent++;
    } catch {
      console.error('Aviso de erro: o e-mail de teste não saiu.');
    }
  }
  return sent ? { ok: true, sent } : { ok: false, status: 502, error: 'O Gmail não aceitou o envio agora. Tente de novo em instantes.' };
}
