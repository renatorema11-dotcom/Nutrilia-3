// Resumo semanal de cada nutricionista e números de uso da Ali. Somente no servidor.
// O resumo sai pelo Gmail da própria nutricionista, para ela mesma. Os números de uso não levam dados de pacientes.
import type { Firestore } from 'firebase-admin/firestore';
import { localDateKey, zonedParts, zonedToDate } from './agenda';
import { emailLayout, escapeHtml, getAccess, loadSettings, p, sendMail } from './google-workspace';
import { reportServerError } from './server-alerts';

const REPORT_DAY_MS = 86_400_000;
const REPORT_DAYS = 7;
/** A partir de quantos dias sem abrir o app o paciente entra na lista de sumidos. */
const AWAY_DAYS = 7;
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Último acesso de cada paciente ao app. Quem dá essa informação é o login (Firebase Auth), por isso a rota
 * entrega a função pronta: data do último acesso, null para quem nunca entrou; quem não tem login fica de fora.
 */
export type LastSeenLookup = (uids: string[]) => Promise<Map<string, Date | null>>;

interface WeekPatient {
  name: string;
  /** Refeições anotadas pela Ali nos últimos 7 dias. */
  meals: number;
  weighed: boolean;
  weight: number | null;
  /** Diferença para a pesagem anterior, em quilos. */
  change: number | null;
  /** Dias desde o último acesso; null quando não foi possível saber. */
  awayDays: number | null;
  neverSeen: boolean;
  plan: 'approved' | 'draft' | 'none';
}

interface WeekAppointment { date: string; time: string; patientName: string; online: boolean }

export interface WeekData { patients: WeekPatient[]; appointments: WeekAppointment[]; seenKnown: boolean }

/** "2026-10-12": a segunda-feira da semana de um instante, no fuso informado. */
export function mondayKey(now: Date, timeZone: string): string {
  const today = zonedParts(now, timeZone);
  const noon = zonedToDate(today.year, today.month, today.day, 12, 0, timeZone).getTime();
  return localDateKey(new Date(noon - ((today.weekday + 6) % 7) * REPORT_DAY_MS), timeZone);
}

/** Junta o que aconteceu com os pacientes de uma nutricionista nos últimos 7 dias e as consultas dos próximos 7. */
export async function collectWeek(db: Firestore, nutritionistId: string, lastSeen: LastSeenLookup, now: Date, timeZone: string): Promise<WeekData> {
  const since = new Date(now.getTime() - REPORT_DAYS * REPORT_DAY_MS);
  const sinceKey = localDateKey(since, timeZone);
  const todayKey = localDateKey(now, timeZone);
  const endKey = localDateKey(new Date(now.getTime() + (REPORT_DAYS - 1) * REPORT_DAY_MS), timeZone);
  const [patientsSnap, userSnap] = await Promise.all([
    db.collection('patients').where('nutritionistId', '==', nutritionistId).get(),
    db.collection('users').doc(nutritionistId).get(),
  ]);
  const docs = patientsSnap.docs.filter((doc) => typeof doc.data()?.name === 'string' && doc.data().name.trim());
  // Sem a informação de acesso, o resumo sai sem a lista de sumidos em vez de acusar todo mundo.
  const seen = await lastSeen(docs.map((doc) => doc.id)).catch(() => null);

  const patients = await Promise.all(docs.map(async (doc): Promise<WeekPatient> => {
    const d = doc.data() || {};
    const logs = await doc.ref.collection('foodLogs').where('loggedAt', '>=', since.toISOString()).get();
    const measurements = (Array.isArray(d.measurements) ? d.measurements : [])
      .filter((m: Record<string, unknown>) => m && typeof m.date === 'string' && DATE_KEY_RE.test(m.date) && typeof m.weight === 'number')
      .sort((a: { date: string }, b: { date: string }) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const lastIndex = measurements.length - 1;
    const last = lastIndex >= 0 && measurements[lastIndex].date >= sinceKey ? measurements[lastIndex] : null;
    const previous = last && lastIndex > 0 ? measurements[lastIndex - 1] : null;
    const seenAt = seen ? seen.get(doc.id) : undefined;
    const status = d.currentPlan?.status;
    return {
      name: String(d.name).trim(),
      meals: logs.docs.length,
      weighed: !!last,
      weight: last ? last.weight : null,
      change: last && previous ? Math.round((last.weight - previous.weight) * 10) / 10 : null,
      awayDays: seenAt ? Math.max(0, Math.floor((now.getTime() - seenAt.getTime()) / REPORT_DAY_MS)) : null,
      // Só vale para quem tem login e nunca entrou; paciente sem login não dá para avaliar.
      neverSeen: !!seen && seen.has(doc.id) && !seenAt,
      plan: status === 'approved' ? 'approved' : status ? 'draft' : 'none',
    };
  }));

  const stored = userSnap.exists ? userSnap.data()?.appointments : [];
  const appointments = (Array.isArray(stored) ? stored : [])
    .filter((a: Record<string, unknown>) => a && a.status === 'Agendada' && typeof a.date === 'string' && DATE_KEY_RE.test(a.date) && a.date >= todayKey && a.date <= endKey)
    .map((a: Record<string, unknown>): WeekAppointment => ({
      date: String(a.date), time: typeof a.time === 'string' ? a.time.slice(0, 5) : '',
      patientName: String(a.patientName || 'Paciente').slice(0, 120), online: a.mode === 'online' || !!a.meetLink,
    }))
    .sort((a: WeekAppointment, b: WeekAppointment) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`))
    .slice(0, 40);

  return { patients: patients.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')), appointments, seenKnown: !!seen };
}

const kilos = (value: number) => `${String(value).replace('.', ',')} kg`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const heading = (text: string) => `<h2 style="margin:20px 0 8px;font-size:16px;color:#276e58">${escapeHtml(text)}</h2>`;
const bullets = (items: string[]) => `<ul style="margin:0 0 12px;padding-left:20px;font-size:15px;line-height:1.6">${items.map((item) => `<li>${item}</li>`).join('')}</ul>`;

function weightNote(patient: WeekPatient): string {
  if (patient.weight === null) return '';
  if (patient.change === null) return `peso ${kilos(patient.weight)}`;
  if (patient.change === 0) return `peso ${kilos(patient.weight)} (sem mudança)`;
  return `peso ${kilos(patient.weight)} (${patient.change > 0 ? '+' : '−'}${kilos(Math.abs(patient.change))})`;
}

/** Monta o e-mail do resumo. Os nomes vêm do cadastro, por isso tudo passa por escapeHtml. */
export function weeklyEmail(data: WeekData, displayName: string, now: Date, timeZone: string): { subject: string; html: string } {
  const dayOf = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'numeric' });
  const today = new Intl.DateTimeFormat('pt-BR', { timeZone, day: 'numeric', month: 'long' }).format(now);
  const active = data.patients.filter((patient) => patient.meals > 0 || patient.weighed);
  const away = data.patients
    .filter((patient) => patient.neverSeen || (patient.awayDays !== null && patient.awayDays >= AWAY_DAYS))
    .sort((a, b) => (b.awayDays ?? Infinity) - (a.awayDays ?? Infinity));
  const drafts = data.patients.filter((patient) => patient.plan === 'draft');
  const noPlan = data.patients.filter((patient) => patient.plan === 'none');
  const names = (list: WeekPatient[]) => list.map((patient) => escapeHtml(patient.name)).join(', ');

  const parts = [
    p(`Olá${displayName ? `, ${escapeHtml(displayName)}` : ''}! Este é o resumo da sua semana no NutriAli, com ${plural(data.patients.length, 'paciente', 'pacientes')}.`),
    heading('Consultas dos próximos 7 dias'),
    data.appointments.length
      ? bullets(data.appointments.map((a) => `${escapeHtml(dayOf.format(new Date(`${a.date}T12:00:00Z`)))}${a.time ? `, às ${escapeHtml(a.time)}` : ''}: <strong>${escapeHtml(a.patientName)}</strong>${a.online ? ' (online)' : ''}`))
      : p('Nenhuma consulta marcada.'),
    heading('Quem registrou nos últimos 7 dias'),
    active.length
      ? bullets(active.map((patient) => `<strong>${escapeHtml(patient.name)}</strong>: ${[
        patient.meals ? `${plural(patient.meals, 'refeição anotada', 'refeições anotadas')} pela Ali` : '', weightNote(patient),
      ].filter(Boolean).join('; ')}`))
      : p('Ninguém anotou refeições pela Ali nem registrou peso nesta semana.'),
  ];
  if (data.seenKnown) {
    parts.push(heading('Quem está sumido'), away.length
      ? bullets(away.map((patient) => `<strong>${escapeHtml(patient.name)}</strong>: ${patient.neverSeen ? 'ainda não entrou no app' : `${patient.awayDays} dias sem abrir o app`}`))
      : p(`Todos os pacientes abriram o app nos últimos ${AWAY_DAYS} dias.`));
  }
  if (drafts.length || noPlan.length) {
    parts.push(heading('Planos alimentares'));
    if (drafts.length) parts.push(p(`Esperando a sua aprovação: ${names(drafts)}.`));
    if (noPlan.length) parts.push(p(`Ainda sem plano: ${names(noPlan)}.`));
  }
  return {
    subject: `Seu resumo da semana (${today})`,
    html: emailLayout('Resumo da semana', parts.join(''), 'Você recebe este resumo toda segunda-feira. Para parar, desligue o resumo semanal na página Minha Ali do NutriAli.'),
  };
}

type SummaryOutcome = 'sent' | 'skipped';

/** Envia o resumo de uma nutricionista, no máximo uma vez por semana. */
export async function sendWeeklySummary(db: Firestore, nutritionistId: string, lastSeen: LastSeenLookup, now: Date): Promise<SummaryOutcome> {
  const settings = await loadSettings(db, nutritionistId);
  if (!settings.weeklySummary) return 'skipped';
  const weekKey = mondayKey(now, settings.timezone);
  const reportRef = db.collection('aliReports').doc(nutritionistId);
  const reportSnap = await reportRef.get();
  if (reportSnap.exists && reportSnap.data()?.weeklyKey === weekKey) return 'skipped';
  // Sem o Google conectado não há por onde enviar.
  const access = await getAccess(db, nutritionistId);
  if (!access.ok) return 'skipped';
  const data = await collectWeek(db, nutritionistId, lastSeen, now, settings.timezone);
  if (!data.patients.length) return 'skipped';
  const mail = weeklyEmail(data, settings.displayName, now, settings.timezone);
  await sendMail(access.token, { fromName: 'NutriAli', fromEmail: access.email, to: access.email, subject: mail.subject, html: mail.html });
  await reportRef.set({ weeklyKey: weekKey, sentAt: now.toISOString() }, { merge: true });
  return 'sent';
}

/** Passa por todas as nutricionistas. A resposta só tem contagens. */
export async function runWeeklySummaries(db: Firestore, lastSeen: LastSeenLookup, now = new Date()) {
  const snap = await db.collection('users').where('role', '==', 'nutritionist').get();
  const totals = { checked: 0, sent: 0, skipped: 0, failed: 0 };
  for (const doc of snap.docs) {
    totals.checked++;
    try {
      totals[await sendWeeklySummary(db, doc.id, lastSeen, now)]++;
    } catch (error) {
      totals.failed++;
      reportServerError('Resumo semanal: falha ao enviar para uma nutricionista.', error);
    }
  }
  return totals;
}

/** Números de uso da Ali nos últimos 7 dias, para o dono do NutriAli. Sem nomes, e-mails ou dados de saúde. */
export async function usageReport(db: Firestore, now = new Date()) {
  const since = new Date(now.getTime() - REPORT_DAYS * REPORT_DAY_MS);
  const [actions, nutritionists, connections, patients] = await Promise.all([
    db.collection('aiActions').where('createdAt', '>=', since.toISOString()).get(),
    db.collection('users').where('role', '==', 'nutritionist').get(),
    db.collection('googleConnections').where('status', '==', 'connected').get(),
    // Só pacientes vinculados a uma nutricionista.
    db.collection('patients').where('nutritionistId', '>=', '').get(),
  ]);
  const byAction: Record<string, number> = {};
  const failedByAction: Record<string, number> = {};
  const activePatients = new Set<string>();
  const activeNutritionists = new Set<string>();
  let byPatients = 0;
  let byNutritionists = 0;
  for (const doc of actions.docs) {
    const d = doc.data() || {};
    const action = typeof d.action === 'string' ? d.action.slice(0, 40) : 'outra';
    if (d.result === 'failed') { failedByAction[action] = (failedByAction[action] || 0) + 1; continue; }
    byAction[action] = (byAction[action] || 0) + 1;
    if (d.actor === 'nutritionist') {
      byNutritionists++;
      if (typeof d.nutritionistId === 'string') activeNutritionists.add(d.nutritionistId);
    } else {
      byPatients++;
      if (typeof d.patientUid === 'string') activePatients.add(d.patientUid);
    }
  }
  const sum = (counts: Record<string, number>) => Object.values(counts).reduce((total, n) => total + n, 0);
  return {
    from: since.toISOString(),
    to: now.toISOString(),
    totals: { nutritionists: nutritionists.docs.length, googleConnected: connections.docs.length, patients: patients.docs.length },
    usage: {
      completed: sum(byAction), failed: sum(failedByAction), byPatients, byNutritionists,
      activePatients: activePatients.size, activeNutritionists: activeNutritionists.size, byAction, failedByAction,
    },
  };
}
