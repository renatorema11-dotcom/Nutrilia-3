// Linha do tempo de um paciente, só leitura: início do acompanhamento, pesagens, anotações das consultas, consultas,
// planos alimentares, pedidos de consulta e a ficha clínica, do mais recente para o mais antigo. Somente no servidor.
// O prontuário é conferido de novo aqui (precisa ser dessa nutricionista) e cada coleção é lida já filtrada por ela.
import type { Firestore } from 'firebase-admin/firestore';
import { cleanText } from './ali-settings';
import { listNotesFor } from './consultation-notes';
import { loadClinicalProfile } from './clinical-profile';
import type { ActionResult } from './google-workspace';

export type TimelineKind = 'inicio' | 'peso' | 'anotacao' | 'consulta' | 'plano' | 'pedido' | 'ficha';
export interface TimelineEvent { date: string; kind: TimelineKind; text: string }

/** Evento com o que só serve aqui dentro: a ordem no mesmo dia e o texto mais curto para falar. */
interface TlEntry extends TimelineEvent { order: number; spoken: string }

// speech: até onde a fala dos eventos vai (a abertura e o "e mais N registros" cabem nos ~600 caracteres).
const TL_LIMITS = { months: 24, defaultMonths: 6, events: 60, noteChars: 160, spokenNoteChars: 90, spokenEvents: 6, speech: 540 };
const TL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TL_FALLBACK_ZONE = 'America/Sao_Paulo';
const TL_APPOINTMENTS = 'aliAppointments';
const TL_REQUESTS = 'appointmentRequests';

const tlValidId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('/');
const tlObject = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null);
const tlNumber = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const tlClip = (text: string, max: number) => { const clean = text.replace(/\s+/g, ' ').trim(); return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean; };
const tlNoon = (key: string) => Date.parse(`${key}T12:00:00Z`);

/** Data AAAA-MM-DD que existe no calendário (31 de fevereiro não passa). */
function tlRealDate(value: unknown): value is string {
  if (typeof value !== 'string' || !TL_DATE_RE.test(value)) return false;
  const day = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

/** Instante gravado: texto ISO ou, em documentos antigos, um Timestamp do Firestore. */
function tlInstant(value: unknown): Date | null {
  if (typeof value === 'string' && value.length <= 40) {
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time) : null;
  }
  const stamp = tlObject(value);
  if (stamp && typeof stamp.toDate === 'function') {
    try {
      const date = (stamp.toDate as () => { getTime?: () => number } | null)();
      const time = date && typeof date.getTime === 'function' ? date.getTime() : NaN;
      return Number.isFinite(time) ? new Date(time) : null;
    } catch { return null; }
  }
  return null;
}

/** Fuso da nutricionista; um fuso que não existe cai no horário de Brasília. */
function tlZone(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 64) return TL_FALLBACK_ZONE;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value }).format(0);
    return value;
  } catch { return TL_FALLBACK_ZONE; }
}

/** Meses pedidos: de 1 a 24, seis quando ninguém disse. null quando o número não serve. */
function tlMonthsOf(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return TL_LIMITS.defaultMonths;
  const months = typeof value === 'number' ? value : typeof value === 'string' && /^\s*\d{1,3}\s*$/.test(value) ? Number(value) : NaN;
  return Number.isInteger(months) && months >= 1 && months <= TL_LIMITS.months ? months : null;
}

/** O mesmo dia, N meses antes (31 de março menos um mês vira 28 ou 29 de fevereiro). */
function tlMonthsBefore(key: string, months: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const index = year * 12 + (month - 1) - months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

/** "12 de outubro"; de outro ano, "12 de outubro de 2025". O dia 1 sai "1º", que se lê "primeiro". */
function tlDayLabel(key: string, thisYear: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: 'numeric', month: 'long', year: key.slice(0, 4) === thisYear ? undefined : 'numeric' })
    .format(new Date(`${key}T12:00:00Z`)).replace(/^1 de /, '1º de ');
}

/**
 * Linha do tempo dos últimos meses (6 quando ninguém disse; de 1 a 24). A fala abre com a mudança de peso no
 * período e conta os eventos mais recentes; a lista completa (até 60) vai em timeline, do mais novo ao mais antigo.
 */
export async function patientTimeline(db: Firestore, nutritionistId: string, patient: { uid: string; name: string }, input: { months?: unknown }, timeZone: string, now = new Date()): Promise<ActionResult> {
  const months = tlMonthsOf(tlObject(input)?.months);
  if (months === null) return { ok: false, status: 422, speech: 'Consigo montar a linha do tempo de 1 a 24 meses. De quantos meses você quer?' };
  const uid = patient && typeof patient.uid === 'string' ? patient.uid : '';
  const notFound: ActionResult = { ok: false, status: 404, speech: 'Não encontrei o prontuário desse paciente entre os seus. Pode repetir o nome?' };
  if (!tlValidId(uid) || !tlValidId(nutritionistId)) return notFound;
  const snap = await db.collection('patients').doc(uid).get();
  const data = snap.exists ? snap.data() || {} : null;
  if (!data || data.nutritionistId !== nutritionistId) return notFound;
  const name = cleanText(patient.name, 120).replace(/\s+/g, ' ') || cleanText(data.name, 120).replace(/\s+/g, ' ');

  const tz = tlZone(timeZone);
  const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  // Montado pelas partes: o formato do en-CA já mudou entre versões do Node; assim sai sempre AAAA-MM-DD.
  const dayOf = (date: Date) => {
    const parts = Object.fromEntries(dayFormat.formatToParts(date).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const hourFormat = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const todayKey = dayOf(now);
  const sinceKey = tlMonthsBefore(todayKey, months);

  const [notes, appointments, requests, profile] = await Promise.all([
    listNotesFor(db, nutritionistId, uid, 50),
    db.collection(TL_APPOINTMENTS).where('nutritionistId', '==', nutritionistId).where('patientUid', '==', uid).get(),
    db.collection(TL_REQUESTS).where('nutritionistId', '==', nutritionistId).where('patientUid', '==', uid).get(),
    loadClinicalProfile(db, nutritionistId, uid),
  ]);

  const entries: TlEntry[] = [];
  const push = (date: string, kind: TimelineKind, text: string, order: number, spoken = text) => {
    if (date >= sinceKey) entries.push({ date, kind, text, order: Number.isFinite(order) ? order : 0, spoken });
  };

  const started = tlInstant(data.createdAt);
  if (started) push(dayOf(started), 'inicio', 'início do acompanhamento', started.getTime());

  // Pesagens válidas, da mais antiga para a mais recente (no mesmo dia, a ordem em que foram gravadas).
  const measures: { date: string; weight: number; bodyFat: number | null; index: number }[] = [];
  (Array.isArray(data.measurements) ? data.measurements.slice(0, 3000) : []).forEach((value: unknown, index: number) => {
    const m = tlObject(value);
    if (!m || !tlRealDate(m.date) || typeof m.weight !== 'number' || !(m.weight > 0 && m.weight < 700)) return;
    const fat = typeof m.bodyFat === 'number' && m.bodyFat > 0 && m.bodyFat < 100 ? Math.round(m.bodyFat * 10) / 10 : null;
    measures.push({ date: m.date, weight: Math.round(m.weight * 10) / 10, bodyFat: fat, index });
  });
  const weights = measures.filter((m) => m.date >= sinceKey).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.index - b.index));
  for (const m of weights) {
    push(m.date, 'peso', `peso de ${tlNumber(m.weight)} quilos${m.bodyFat === null ? '' : `, com ${tlNumber(m.bodyFat)} por cento de gordura`}`, tlNoon(m.date) + m.index);
  }

  // Planos: o atual (criado e aprovado), o rascunho novo esperando aprovação e os anteriores.
  const current = tlObject(data.currentPlan);
  if (current && tlRealDate(current.createdDate)) {
    const approved = current.status === 'approved';
    const byAli = current.source === 'ali';
    const approvedAt = approved ? tlInstant(data.planApprovedAt) : null;
    const approvedKey = approvedAt ? dayOf(approvedAt) : null;
    if (approvedKey !== current.createdDate) {
      push(current.createdDate, 'plano', approved
        ? `plano alimentar criado${byAli ? ', a partir do rascunho da Ali' : ''}`
        : `rascunho de plano${byAli ? ' feito pela Ali' : ''}, esperando a sua aprovação`, tlNoon(current.createdDate));
    }
    if (approvedAt && approvedKey) push(approvedKey, 'plano', 'plano alimentar aprovado', approvedAt.getTime());
  }
  const pending = tlObject(data.pendingPlan);
  if (pending && tlRealDate(pending.createdDate)) {
    push(pending.createdDate, 'plano', `rascunho novo de plano${pending.source === 'ali' ? ' feito pela Ali' : ''}, esperando a sua aprovação`, tlNoon(pending.createdDate));
  }
  for (const value of Array.isArray(data.pastPlans) ? data.pastPlans.slice(0, 100) : []) {
    const plan = tlObject(value);
    if (plan && tlRealDate(plan.createdDate)) push(plan.createdDate, 'plano', `${plan.status === 'approved' ? 'plano alimentar criado' : 'rascunho de plano'}, depois substituído`, tlNoon(plan.createdDate) - 1);
  }

  for (const note of notes) {
    const at = tlInstant(note.createdAt);
    if (at) push(dayOf(at), 'anotacao', `anotação da consulta: ${tlClip(note.text, TL_LIMITS.noteChars)}`, at.getTime(), `anotação da consulta: ${tlClip(note.text, TL_LIMITS.spokenNoteChars)}`);
  }

  // Consultas da Ali: as que já passaram, as marcadas para a frente e as canceladas.
  for (const doc of appointments.docs) {
    const a = doc.data() || {};
    const start = a.nutritionistId === nutritionistId && a.patientUid === uid ? tlInstant(a.startAt) : null;
    if (!start || (a.status !== 'scheduled' && a.status !== 'cancelled')) continue;
    const mode = a.mode === 'presencial' || a.mode === 'online' ? a.mode : '';
    const text = a.status === 'cancelled'
      ? 'consulta cancelada'
      : start.getTime() > now.getTime() ? `consulta marcada, às ${hourFormat.format(start)}${mode ? `, ${mode}` : ''}` : `consulta${mode ? ` ${mode}` : ''}`;
    push(dayOf(start), 'consulta', text, start.getTime());
  }

  for (const doc of requests.docs) {
    const r = doc.data() || {};
    const at = r.nutritionistId === nutritionistId && r.patientUid === uid ? tlInstant(r.createdAt) : null;
    if (!at) continue;
    const preferred = cleanText(r.preferredDate, 100).replace(/\s+/g, ' ');
    const wish = !preferred || preferred === 'a combinar' ? 'sem data de preferência' : `com preferência por ${tlClip(preferred, 60)}`;
    const state = r.status === 'pending' ? ', esperando resposta' : r.status === 'confirmed' ? ', atendido' : r.status === 'declined' ? ', não atendido' : '';
    push(dayOf(at), 'pedido', `pedido de consulta ${wish}${state}`, at.getTime());
  }

  const updated = tlInstant(profile.updatedAt);
  if (updated) push(dayOf(updated), 'ficha', 'ficha clínica atualizada', updated.getTime());

  entries.sort((a, b) => (a.date === b.date ? b.order - a.order : a.date < b.date ? 1 : -1));
  const who = name || 'o paciente';
  const period = months === 1 ? 'No último mês' : `Nos últimos ${months} meses`;
  const base = { months, since: sinceKey, total: entries.length };
  if (!entries.length) return { ok: true, speech: `${period}, não há nenhum registro ${name ? `de ${name}` : 'desse paciente'}.`, ...base, timeline: [], weight: null };

  const thisYear = todayKey.slice(0, 4);
  const first = weights[0];
  const last = weights[weights.length - 1];
  const change = first && last ? Math.round((last.weight - first.weight) * 10) / 10 : 0;
  let opening: string;
  if (!weights.length) opening = `${period}, ${who} não teve pesagens registradas.`;
  else if (weights.length === 1) opening = `${period}, ${who} teve uma pesagem: ${tlNumber(last.weight)} quilos, em ${tlDayLabel(last.date, thisYear)}.`;
  else if (change === 0) opening = `${period}, ${who} manteve ${tlNumber(last.weight)} quilos, em ${weights.length} pesagens.`;
  else opening = `${period}, ${who} foi de ${tlNumber(first.weight)} para ${tlNumber(last.weight)} quilos, ${tlNumber(Math.abs(change))} a ${change < 0 ? 'menos' : 'mais'}, em ${weights.length} pesagens.`;

  // Os eventos mais recentes, juntando os do mesmo dia numa frase só, sem passar do tamanho da fala.
  const groups: { date: string; texts: string[] }[] = [];
  const render = () => groups.map((group) => ` Em ${tlDayLabel(group.date, thisYear)}, ${group.texts.join('; ')}.`).join('');
  let told = 0;
  for (const entry of entries.slice(0, TL_LIMITS.spokenEvents)) {
    const group = groups[groups.length - 1];
    const joined = !!group && group.date === entry.date;
    if (joined) group.texts.push(entry.spoken);
    else groups.push({ date: entry.date, texts: [entry.spoken] });
    if (told > 0 && opening.length + render().length > TL_LIMITS.speech) {
      if (joined) group.texts.pop();
      else groups.pop();
      break;
    }
    told++;
  }
  const rest = entries.length - told;
  return {
    ok: true,
    speech: `${opening}${render()}${rest > 0 ? ` E mais ${rest} ${rest === 1 ? 'registro' : 'registros'}.` : ''}`,
    ...base,
    timeline: entries.slice(0, TL_LIMITS.events).map(({ date, kind, text }) => ({ date, kind, text })),
    weight: weights.length ? { first: first.weight, last: last.weight, change, measurements: weights.length, firstDate: first.date, lastDate: last.date } : null,
  };
}
