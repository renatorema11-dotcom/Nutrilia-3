// Ali da nutricionista: pacientes, agenda e e-mails da própria nutricionista. Somente no servidor.
// Cada função recebe o uid já conferido pela rota e só enxerga os dados dessa nutricionista.
import type { Firestore } from 'firebase-admin/firestore';
import { cleanText, describeAttendance, describeClinic, joinPt, matchByName, sanitizeContacts } from './ali-settings';
import type { AliContact } from './ali-settings';
import { describeDates, isFree, localDateKey, parseLocalDateTime, slotLabel, toOffsetIso } from './agenda';
import type { Interval } from './agenda';
import { cancelNextByNutritionist, rescheduleNextByNutritionist } from './appointments';
import { APPOINTMENTS_COLLECTION, CALENDAR_EVENTS_URL, busyIntervals, connectionStatus, createAppointment, emailLayout, escapeHtml, getAccess, googleRequest, isValidEmail, loadSettings, newNonce, p, sendMail, sendPlanEmail } from './google-workspace';
import type { ActionResult } from './google-workspace';
import { collectWeek } from './weekly-report';
import type { LastSeenLookup } from './weekly-report';
import { MOOD_LABELS, moodToday, waterToday } from './daily-log';
import { cleanNote, listNotesFor, saveNote } from './consultation-notes';

const NOT_CONNECTED = 'A sua conta do Google não está conectada à Ali. Entre em Minha Ali e clique em Conectar Google.';
const DAILY_EMAIL_LIMIT = 40;
const ONE_DAY_MS = 86_400_000;

// ───────────── Contatos salvos ─────────────

export async function loadContacts(db: Firestore, nutritionistId: string): Promise<AliContact[]> {
  const snap = await db.collection('nutritionistSettings').doc(nutritionistId).get();
  return sanitizeContacts(snap.exists ? snap.data()?.contacts : []);
}

export async function saveContacts(db: Firestore, nutritionistId: string, input: unknown): Promise<AliContact[]> {
  const contacts = sanitizeContacts(input);
  await db.collection('nutritionistSettings').doc(nutritionistId).set({ contacts, updatedAt: new Date().toISOString() }, { merge: true });
  return contacts;
}

// ───────────── Pacientes ─────────────

interface PatientRow {
  uid: string;
  name: string;
  email: string | null;
  objective: string;
  weight: number | null;
  targetWeight: number | null;
  nextAppointment: string;
  plan: 'approved' | 'draft' | 'none';
}

async function loadPatients(db: Firestore, nutritionistId: string): Promise<PatientRow[]> {
  const snap = await db.collection('patients').where('nutritionistId', '==', nutritionistId).get();
  return snap.docs
    .map((doc) => {
      const d = doc.data() || {};
      const status = d.currentPlan?.status;
      return {
        uid: doc.id,
        name: typeof d.name === 'string' ? d.name.trim() : '',
        email: isValidEmail(d.email) ? d.email : null,
        objective: typeof d.objective === 'string' ? d.objective : '',
        weight: typeof d.weight === 'number' ? d.weight : null,
        targetWeight: typeof d.targetWeight === 'number' ? d.targetWeight : null,
        nextAppointment: typeof d.nextAppointment === 'string' ? d.nextAppointment : '',
        plan: status === 'approved' ? 'approved' as const : status ? 'draft' as const : 'none' as const,
      };
    })
    .filter((patient) => patient.name)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

type Picked<T> = { ok: true; value: T } | { ok: false; result: ActionResult };

/** Um nome falado precisa apontar para uma pessoa só; senão a Ali pergunta de novo. */
function pickOne<T extends { name: string }>(people: T[], spoken: unknown, kind: string): Picked<T> {
  const name = cleanText(spoken, 120);
  if (!name) return { ok: false, result: { ok: false, status: 422, speech: `Qual é o nome ${kind}?` } };
  const matches = matchByName(people, name);
  if (matches.length === 1) return { ok: true, value: matches[0] };
  if (!matches.length) return { ok: false, result: { ok: false, status: 404, speech: `Não encontrei ninguém com o nome ${name}. Pode repetir o nome completo?` } };
  return { ok: false, result: { ok: false, status: 409, speech: `Encontrei mais de uma pessoa: ${joinPt(matches.slice(0, 5).map((m) => m.name))}. Qual delas?` } };
}

export async function listPatients(db: Firestore, nutritionistId: string, search: unknown): Promise<ActionResult> {
  const all = await loadPatients(db, nutritionistId);
  if (!all.length) return { ok: true, speech: 'Você ainda não tem pacientes vinculados no NutriAli.', patients: [] };
  const query = cleanText(search, 120);
  const found = query ? matchByName(all, query) : all;
  if (!found.length) return { ok: true, speech: `Não encontrei paciente com o nome ${query}. Você tem ${all.length} no total.`, patients: [] };
  const spoken = found.slice(0, 12).map((patient) => patient.name);
  const rest = found.length - spoken.length;
  return {
    ok: true,
    speech: `${query ? 'Encontrei' : 'Você tem'} ${found.length} ${found.length === 1 ? 'paciente' : 'pacientes'}: ${joinPt(spoken)}${rest > 0 ? `, e mais ${rest}` : ''}.`,
    patients: found.slice(0, 40).map((patient) => ({ name: patient.name, objective: patient.objective, nextAppointment: patient.nextAppointment })),
  };
}

export async function patientSummary(db: Firestore, nutritionistId: string, name: unknown): Promise<ActionResult> {
  const picked = pickOne(await loadPatients(db, nutritionistId), name, 'do paciente');
  if (!picked.ok) return picked.result;
  const patient = picked.value;
  const plan = patient.plan === 'approved' ? 'plano aprovado' : patient.plan === 'draft' ? 'plano em rascunho, esperando a sua aprovação' : 'ainda sem plano';
  return {
    ok: true,
    speech: `${patient.name}: objetivo ${patient.objective || 'não informado'}; `
      + `peso atual ${patient.weight ?? 'não informado'}${patient.weight === null ? '' : ' quilos'}, meta ${patient.targetWeight ?? 'não informada'}${patient.targetWeight === null ? '' : ' quilos'}; `
      + `${plan}; próxima consulta ${patient.nextAppointment || 'não agendada'}; `
      + `${patient.email ? 'tem e-mail cadastrado' : 'sem e-mail cadastrado'}.`,
    patient: { name: patient.name, objective: patient.objective, weight: patient.weight, targetWeight: patient.targetWeight, plan: patient.plan, nextAppointment: patient.nextAppointment, hasEmail: !!patient.email },
  };
}

// ───────────── Agenda ─────────────

function accessProblem(reason: 'not_configured' | 'not_connected' | 'needs_reconnect' | 'unavailable'): ActionResult {
  if (reason === 'unavailable') return { ok: false, status: 502, speech: 'Não consegui falar com o Google agora. Tente de novo em instantes.' };
  return { ok: false, status: 409, speech: NOT_CONNECTED };
}

const dayLabel = (date: Date, timeZone: string) => new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(date);
const timeLabel = (date: Date, timeZone: string) => new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);

/** Compromissos da agenda do Google em um dia ou em alguns dias seguidos (no máximo 7). */
export async function agenda(db: Firestore, nutritionistId: string, input: { date?: unknown; days?: unknown }, now = new Date()): Promise<ActionResult> {
  const access = await getAccess(db, nutritionistId);
  if (!access.ok) return accessProblem(access.reason);
  const tz = (await loadSettings(db, nutritionistId)).timezone;
  const date = typeof input.date === 'string' && input.date.trim() ? input.date.trim() : localDateKey(now, tz);
  const start = parseLocalDateTime(date, '00:00', tz);
  if (!start) return { ok: false, status: 422, speech: 'Para qual dia? Diga a data completa.' };
  const days = typeof input.days === 'number' && Number.isInteger(input.days) && input.days >= 1 && input.days <= 7 ? input.days : 1;
  const end = new Date(start.getTime() + days * ONE_DAY_MS);
  const query = new URLSearchParams({ timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '50' });
  const res = await googleRequest(access.token, 'GET', `${CALENDAR_EVENTS_URL}?${query}`).catch(() => null);
  if (!res || !res.ok) return { ok: false, status: 502, speech: 'Não consegui ver a sua agenda agora. Tente de novo em instantes.' };

  const events = (Array.isArray(res.json.items) ? res.json.items : [])
    .filter((item: Record<string, any>) => item && item.status !== 'cancelled')
    .map((item: Record<string, any>) => {
      const allDay = !item.start?.dateTime;
      const when = new Date(item.start?.dateTime || `${item.start?.date}T12:00:00Z`);
      const title = cleanText(item.summary, 120) || 'Compromisso sem título';
      return { title, allDay, start: allDay ? String(item.start?.date || '') : toOffsetIso(when, tz), day: allDay ? String(item.start?.date || '') : localDateKey(when, tz), time: allDay ? '' : timeLabel(when, tz), when };
    });
  const period = days === 1 ? dayLabel(start, tz) : `de ${dayLabel(start, tz)} a ${dayLabel(new Date(end.getTime() - ONE_DAY_MS), tz)}`;
  if (!events.length) return { ok: true, speech: `Você não tem nenhum compromisso ${days === 1 ? `em ${period}` : period}.`, events: [] };
  const describe = (event: (typeof events)[number]) => {
    const prefix = days === 1 ? '' : `${dayLabel(event.allDay ? new Date(`${event.day}T12:00:00Z`) : event.when, tz).split(',')[0]}, `;
    return `${prefix}${event.allDay ? 'o dia todo' : `às ${event.time}`}, ${event.title}`;
  };
  const spoken = events.slice(0, 12).map(describe);
  return {
    ok: true,
    speech: `${days === 1 ? `Em ${period}` : `No período ${period}`}, você tem ${events.length} ${events.length === 1 ? 'compromisso' : 'compromissos'}: ${spoken.join('; ')}${events.length > spoken.length ? `; e mais ${events.length - spoken.length}` : ''}.`,
    events: events.slice(0, 40).map((event: (typeof events)[number]) => ({ title: event.title, start: event.start, allDay: event.allDay })),
  };
}

type Timing = { ok: true; start: Date; end: Date } | { ok: false; result: ActionResult };

function readTiming(date: unknown, time: unknown, minutes: number, timeZone: string, now: Date): Timing {
  const start = parseLocalDateTime(date, time, timeZone);
  if (!start) return { ok: false, result: { ok: false, status: 422, speech: 'Para quando? Diga o dia e a hora.' } };
  if (start.getTime() < now.getTime() + 5 * 60_000) return { ok: false, result: { ok: false, status: 422, speech: 'Esse horário já passou. Diga outro dia ou outra hora.' } };
  if (start.getTime() > now.getTime() + 366 * ONE_DAY_MS) return { ok: false, result: { ok: false, status: 422, speech: 'Só consigo marcar para até um ano à frente.' } };
  return { ok: true, start, end: new Date(start.getTime() + minutes * 60_000) };
}

/** Avisa quando o horário bate com outro compromisso; com force, a nutricionista já mandou marcar assim mesmo. */
async function conflictWarning(token: string, start: Date, end: Date, timeZone: string, force: unknown): Promise<ActionResult | null> {
  if (force === true) return null;
  let busy: Interval[];
  try { busy = await busyIntervals(token, { start: new Date(start.getTime() - 3_600_000), end: new Date(end.getTime() + 3_600_000) }, timeZone); }
  catch { return { ok: false, status: 502, speech: 'Não consegui ver a sua agenda agora. Tente de novo em instantes.' }; }
  return isFree(start, end, busy, 0) ? null : { ok: false, status: 409, speech: 'Você já tem um compromisso nesse horário. Quer marcar mesmo assim?' };
}

export interface ConsultationInput { patientName?: unknown; date?: unknown; time?: unknown; mode?: unknown; notes?: unknown; force?: unknown }

/** Consulta com um paciente dela, no horário que a nutricionista escolher (entra nos lembretes como as outras). */
export async function scheduleConsultation(db: Firestore, nutritionistId: string, input: ConsultationInput, now = new Date()): Promise<ActionResult> {
  const picked = pickOne(await loadPatients(db, nutritionistId), input.patientName, 'do paciente');
  if (!picked.ok) return picked.result;
  const patient = picked.value;
  const access = await getAccess(db, nutritionistId);
  if (!access.ok) return accessProblem(access.reason);
  const settings = await loadSettings(db, nutritionistId);
  const timing = readTiming(input.date, input.time, settings.durationMinutes, settings.timezone, now);
  if (!timing.ok) return timing.result;
  const conflict = await conflictWarning(access.token, timing.start, timing.end, settings.timezone, input.force);
  if (conflict) return conflict;
  const mode = settings.mode === 'ambos' ? (input.mode === 'presencial' ? 'presencial' : 'online') : settings.mode;
  const result = await createAppointment(db, access, settings, {
    nutritionistId, patientUid: patient.uid, patientName: patient.name, patientEmail: patient.email,
    start: timing.start, end: timing.end, mode, notes: cleanText(input.notes, 500), bookedBy: 'nutritionist',
  }, now);
  if (!result.ok) return result;
  // Marcar a consulta de quem tinha pedido é atender o pedido: ele sai da lista de pendentes.
  try {
    const booked = result.appointment as { label?: unknown } | undefined;
    const closed = await closeRequestsAfterBooking(db, nutritionistId, patient.uid, typeof booked?.label === 'string' ? booked.label : '', now);
    if (closed) return { ...result, speech: `${result.speech} O pedido de consulta que estava aberto foi marcado como atendido.` };
  } catch {
    console.error('Ali da nutricionista: consulta marcada, mas o pedido de consulta não foi encerrado.');
  }
  return result;
}

export async function cancelConsultation(db: Firestore, nutritionistId: string, patientName: unknown, now = new Date()): Promise<ActionResult> {
  const picked = pickOne(await loadPatients(db, nutritionistId), patientName, 'do paciente');
  if (!picked.ok) return picked.result;
  return cancelNextByNutritionist(db, nutritionistId, picked.value.uid, now);
}

export interface RescheduleInput { patientName?: unknown; date?: unknown; time?: unknown; force?: unknown }

/** Troca o horário da próxima consulta de um paciente dela, sem precisar cancelar e marcar de novo. */
export async function rescheduleConsultation(db: Firestore, nutritionistId: string, input: RescheduleInput, now = new Date()): Promise<ActionResult> {
  const picked = pickOne(await loadPatients(db, nutritionistId), input.patientName, 'do paciente');
  if (!picked.ok) return picked.result;
  const settings = await loadSettings(db, nutritionistId);
  const timing = readTiming(input.date, input.time, settings.durationMinutes, settings.timezone, now);
  if (!timing.ok) return timing.result;
  return rescheduleNextByNutritionist(db, nutritionistId, picked.value.uid, timing.start, input.force === true, now);
}

// ───────────── Prontuário, chat e plano ─────────────

/** Número ditado ("72,4" ou 72.4), arredondado a uma casa. NaN quando não é número. */
function spokenNumber(value: unknown): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.trim().replace(',', '.')) : NaN;
  return Math.round(number * 10) / 10;
}

const spokenKilos = (value: number) => `${String(value).replace('.', ',')} ${value === 1 ? 'quilo' : 'quilos'}`;

export interface MeasurementInput { patientName?: unknown; weight?: unknown; bodyFat?: unknown }

/** Peso (e percentual de gordura, se ela disser) de um paciente dela, com a data de hoje, direto no prontuário. */
export async function logMeasurement(db: Firestore, nutritionistId: string, input: MeasurementInput, now = new Date()): Promise<ActionResult> {
  const picked = pickOne(await loadPatients(db, nutritionistId), input.patientName, 'do paciente');
  if (!picked.ok) return picked.result;
  const patient = picked.value;
  const weight = spokenNumber(input.weight);
  if (!(weight >= 20 && weight <= 500)) return { ok: false, status: 422, speech: 'Qual é o peso, em quilos? Por exemplo, setenta e dois vírgula quatro.' };
  const hasFat = input.bodyFat !== undefined && input.bodyFat !== null && input.bodyFat !== '';
  const bodyFat = hasFat ? spokenNumber(input.bodyFat) : null;
  if (bodyFat !== null && !(bodyFat > 0 && bodyFat < 100)) return { ok: false, status: 422, speech: 'O percentual de gordura precisa ficar entre zero e cem.' };

  const today = localDateKey(now, (await loadSettings(db, nutritionistId)).timezone);
  const ref = db.collection('patients').doc(patient.uid);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() || {} : {};
  const measurements: Record<string, unknown>[] = (Array.isArray(data.measurements) ? data.measurements : []).filter((m: unknown) => m && typeof m === 'object');
  const entry = {
    date: today, weight,
    ...(bodyFat !== null ? { bodyFat } : {}),
    ...(typeof data.height === 'number' ? { height: data.height } : {}),
    source: 'nutritionist',
  };
  const last = measurements[measurements.length - 1];
  // Corrigir o valor no mesmo dia troca a medição de hoje em vez de empilhar outra.
  if (last && last.date === today && last.source === 'nutritionist') measurements[measurements.length - 1] = entry;
  else measurements.push(entry);
  await ref.set({ weight, ...(bodyFat !== null ? { bodyFat } : {}), measurements }, { merge: true });

  const target = patient.targetWeight;
  const gap = target === null ? null : Math.round(Math.abs(weight - target) * 10) / 10;
  return {
    ok: true,
    speech: `Anotei ${spokenKilos(weight)}${bodyFat !== null ? ` e ${String(bodyFat).replace('.', ',')} por cento de gordura` : ''} no prontuário de ${patient.name}, com a data de hoje.`
      + (gap === null ? '' : gap === 0 ? ` A meta de ${spokenKilos(target as number)} foi atingida.` : ` A diferença para a meta de ${spokenKilos(target as number)} é de ${spokenKilos(gap)}.`),
    measurement: { patientName: patient.name, date: today, weight, bodyFat },
  };
}

const CHAT_MESSAGE_MAX = 1000;

export interface ChatMessageInput { patientName?: unknown; text?: unknown }

/** Recado no chat direto com um paciente dela: aparece para ele na aba "Nutricionista" do Chat. */
export async function sendChatMessage(db: Firestore, nutritionistId: string, input: ChatMessageInput, now = new Date()): Promise<ActionResult> {
  const picked = pickOne(await loadPatients(db, nutritionistId), input.patientName, 'do paciente');
  if (!picked.ok) return picked.result;
  const patient = picked.value;
  const text = cleanText(input.text, CHAT_MESSAGE_MAX + 1);
  if (text.length < 2) return { ok: false, status: 422, speech: 'Qual é o recado?' };
  if (text.length > CHAT_MESSAGE_MAX) return { ok: false, status: 422, speech: 'O recado ficou longo demais para o chat. Resuma em poucas frases ou mande por e-mail.' };

  await postChatMessage(db, nutritionistId, patient.uid, text, now);
  return { ok: true, speech: `Recado enviado para ${patient.name} no chat do aplicativo.`, message: { to: patient.name } };
}

/** Mesmo endereço e mesmo formato das mensagens que ela escreve na tela "Chat com Pacientes". */
async function postChatMessage(db: Firestore, nutritionistId: string, patientUid: string, text: string, now: Date): Promise<void> {
  const settings = await loadSettings(db, nutritionistId);
  const chat = db.collection('chats').doc(`${patientUid}_${nutritionistId}`);
  await chat.set({ updatedAt: now }, { merge: true });
  await chat.collection('messages').add({
    senderId: nutritionistId, senderName: settings.displayName || 'Nutricionista', senderRole: 'nutritionist', text, createdAt: now.toISOString(),
  });
}

/** Envia o plano alimentar aprovado de um paciente dela para o e-mail dele, pelo Gmail dela. */
export async function sendPlanToPatient(db: Firestore, nutritionistId: string, patientName: unknown): Promise<ActionResult> {
  const picked = pickOne(await loadPatients(db, nutritionistId), patientName, 'do paciente');
  if (!picked.ok) return picked.result;
  const patient = picked.value;
  if (!patient.email) return { ok: false, status: 422, speech: `${patient.name} não tem e-mail cadastrado.` };
  if (patient.plan !== 'approved') {
    return { ok: false, status: 409, speech: patient.plan === 'draft'
      ? `O plano de ${patient.name} ainda está em rascunho. Aprove no aplicativo antes de enviar.`
      : `${patient.name} ainda não tem plano alimentar.` };
  }
  const access = await getAccess(db, nutritionistId);
  if (!access.ok) return accessProblem(access.reason);

  const snap = await db.collection('patients').doc(patient.uid).get();
  const stored = snap.exists ? snap.data()?.currentPlan?.days : [];
  const days = (Array.isArray(stored) ? stored : []).slice(0, 7).map((day: Record<string, unknown>) => ({
    name: String(day?.name || '').slice(0, 100),
    meals: (Array.isArray(day?.meals) ? day.meals : []).slice(0, 10).map((meal: Record<string, unknown>) => ({
      name: String(meal?.name || '').slice(0, 100), time: String(meal?.time || '').slice(0, 30),
      items: (Array.isArray(meal?.items) ? meal.items : []).slice(0, 12).map((item: unknown) => String(item).slice(0, 500)),
    })),
  })).filter((day) => day.meals.length);
  if (!days.length) return { ok: false, status: 409, speech: `O plano de ${patient.name} está sem refeições. Confira no aplicativo antes de enviar.` };

  const result = await sendPlanEmail(db, { nutritionistId, patientUid: patient.uid, patientName: patient.name, patientEmail: patient.email, days });
  if (!result.ok) return { ok: false, status: 502, speech: 'Não consegui enviar o e-mail agora. Nada foi enviado. Tente de novo em instantes.' };
  return { ok: true, speech: `O plano alimentar de ${patient.name} foi enviado para o e-mail cadastrado.`, email: { to: patient.name, subject: 'Seu plano alimentar' } };
}

// ───────────── Resumo da semana ─────────────

const SUMMARY_NAMES = 5;
/** A partir de quantos dias sem abrir o app o paciente conta como sumido (o mesmo do resumo por e-mail). */
const SUMMARY_AWAY_DAYS = 7;

/** Lista curta para falar: os primeiros nomes e quantos ficaram de fora. */
function spokenNames(names: string[]): string {
  const first = names.slice(0, SUMMARY_NAMES);
  return joinPt(first) + (names.length > first.length ? `, e mais ${names.length - first.length}` : '');
}

/** Os mesmos números do resumo semanal por e-mail, em poucas frases para a Ali dizer. */
export async function weekSummary(db: Firestore, nutritionistId: string, lastSeen: LastSeenLookup, now = new Date()): Promise<ActionResult> {
  const tz = (await loadSettings(db, nutritionistId)).timezone;
  const data = await collectWeek(db, nutritionistId, lastSeen, now, tz);
  if (!data.patients.length) return { ok: true, speech: 'Você ainda não tem pacientes vinculados no NutriAli.', summary: { patients: 0 } };

  const active = data.patients.filter((patient) => patient.meals > 0 || patient.weighed);
  const away = data.patients
    .filter((patient) => patient.neverSeen || (patient.awayDays !== null && patient.awayDays >= SUMMARY_AWAY_DAYS))
    .sort((a, b) => (b.awayDays ?? Infinity) - (a.awayDays ?? Infinity));
  const drafts = data.patients.filter((patient) => patient.plan === 'draft');
  const noPlan = data.patients.filter((patient) => patient.plan === 'none');
  const dayOf = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'long', day: 'numeric' });

  const parts = [`Você tem ${data.patients.length} ${data.patients.length === 1 ? 'paciente' : 'pacientes'}.`];
  if (data.appointments.length) {
    const next = data.appointments[0];
    parts.push(`Nos próximos sete dias há ${data.appointments.length} ${data.appointments.length === 1 ? 'consulta marcada' : 'consultas marcadas'}; a primeira é ${dayOf.format(new Date(`${next.date}T12:00:00Z`))}${next.time ? `, às ${next.time}` : ''}, com ${next.patientName}.`);
  } else parts.push('Não há consultas marcadas para os próximos sete dias.');
  parts.push(active.length
    ? `Nos últimos sete dias, ${active.length === 1 ? 'registrou refeição ou peso' : 'registraram refeição ou peso'}: ${spokenNames(active.map((patient) => patient.name))}.`
    : 'Nos últimos sete dias ninguém registrou refeição nem peso.');
  if (data.seenKnown) {
    parts.push(away.length
      ? `Sem abrir o aplicativo há uma semana ou mais: ${spokenNames(away.map((patient) => patient.name))}.`
      : 'Todos abriram o aplicativo nos últimos sete dias.');
  }
  if (drafts.length) parts.push(`Planos esperando a sua aprovação: ${spokenNames(drafts.map((patient) => patient.name))}.`);
  if (noPlan.length) parts.push(`Ainda sem plano: ${spokenNames(noPlan.map((patient) => patient.name))}.`);
  return {
    ok: true,
    speech: parts.join(' '),
    summary: {
      patients: data.patients.length, appointments: data.appointments.length, active: active.map((patient) => patient.name),
      away: data.seenKnown ? away.map((patient) => patient.name) : null, drafts: drafts.map((patient) => patient.name), noPlan: noPlan.map((patient) => patient.name),
    },
  };
}

// ───────────── Fase 2: pedidos de consulta, anotações, resumo antes da consulta e quem precisa de atenção ─────────────

/** Texto longo encurtado para a Ali falar. */
function clipSpoken(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

const withPeriod = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`);

/** "13 de outubro", a partir de uma data AAAA-MM-DD. */
const dateKeyLabel = (key: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(new Date(`${key}T12:00:00Z`));

/** "13 de outubro", a partir de um instante gravado, no fuso da nutricionista. */
const noteDay = (iso: string, timeZone: string) => new Intl.DateTimeFormat('pt-BR', { timeZone, day: 'numeric', month: 'long' }).format(new Date(iso));

const MEASURE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Medições com data e peso válidos, da mais antiga para a mais recente. */
function measurementsOf(data: Record<string, unknown>): { date: string; weight: number }[] {
  return (Array.isArray(data.measurements) ? data.measurements : [])
    .filter((m: Record<string, unknown>) => m && typeof m.date === 'string' && MEASURE_DATE_RE.test(m.date) && typeof m.weight === 'number')
    .map((m: Record<string, unknown>) => ({ date: m.date as string, weight: m.weight as number }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

interface PendingRequest { id: string; patientUid: string; patientName: string; preferredDate: string; notes: string; createdAt: string }

/** Pedidos de consulta que os pacientes dela fizeram pela Ali e ainda não tiveram resposta, do mais antigo ao mais novo. */
async function pendingRequests(db: Firestore, nutritionistId: string): Promise<PendingRequest[]> {
  const snap = await db.collection('appointmentRequests').where('nutritionistId', '==', nutritionistId).where('status', '==', 'pending').get();
  return snap.docs
    .map((doc) => {
      const d = doc.data() || {};
      return {
        id: doc.id, patientUid: typeof d.patientUid === 'string' ? d.patientUid : '',
        patientName: cleanText(d.patientName, 120) || 'Paciente', preferredDate: cleanText(d.preferredDate, 100) || 'a combinar',
        notes: cleanText(d.notes, 1000), createdAt: typeof d.createdAt === 'string' ? d.createdAt : '',
      };
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** A Ali grava "a combinar" quando o paciente não disse a data. */
const preference = (preferredDate: string) => (preferredDate === 'a combinar' ? 'sem data de preferência' : `com preferência por ${preferredDate}`);

function requestAge(createdAt: string, now: Date): string {
  const days = Math.floor((now.getTime() - Date.parse(createdAt)) / ONE_DAY_MS);
  if (!Number.isFinite(days) || days <= 0) return 'pedido hoje';
  return days === 1 ? 'pedido ontem' : `pedido há ${days} dias`;
}

/** Marcar a consulta de quem tinha pedido atende o pedido: o paciente passa a ver "Confirmada" no app. */
async function closeRequestsAfterBooking(db: Firestore, nutritionistId: string, patientUid: string, label: string, now: Date): Promise<number> {
  const open = (await pendingRequests(db, nutritionistId)).filter((request) => request.patientUid === patientUid);
  await Promise.all(open.map((request) => db.collection('appointmentRequests').doc(request.id)
    .set({ status: 'confirmed', answeredAt: now.toISOString(), ...(label ? { appointmentLabel: label } : {}) }, { merge: true })));
  return open.length;
}

export async function listAppointmentRequests(db: Firestore, nutritionistId: string, now = new Date()): Promise<ActionResult> {
  const requests = await pendingRequests(db, nutritionistId);
  if (!requests.length) return { ok: true, speech: 'Não há pedidos de consulta esperando resposta.', requests: [] };
  const spoken = requests.slice(0, 8).map((request) => `${request.patientName}, ${preference(request.preferredDate)}, ${requestAge(request.createdAt, now)}`
    + (request.notes ? `; observação: ${clipSpoken(request.notes, 160)}` : ''));
  return {
    ok: true,
    speech: `Você tem ${requests.length} ${requests.length === 1 ? 'pedido de consulta esperando resposta' : 'pedidos de consulta esperando resposta'}: `
      + `${spoken.map(withPeriod).join(' ')}${requests.length > spoken.length ? ` E mais ${requests.length - spoken.length}.` : ''}`,
    requests: requests.slice(0, 20).map((request) => ({ patientName: request.patientName, preferredDate: request.preferredDate, notes: request.notes, createdAt: request.createdAt })),
  };
}

export interface DeclineInput { patientName?: unknown; text?: unknown }

/** Encerra o pedido de consulta de um paciente sem marcar; com texto, o recado vai para o chat dele. */
export async function declineAppointmentRequest(db: Firestore, nutritionistId: string, input: DeclineInput, now = new Date()): Promise<ActionResult> {
  const picked = pickOne(await loadPatients(db, nutritionistId), input.patientName, 'do paciente');
  if (!picked.ok) return picked.result;
  const patient = picked.value;
  const open = (await pendingRequests(db, nutritionistId)).filter((request) => request.patientUid === patient.uid);
  if (!open.length) return { ok: false, status: 409, speech: `${patient.name} não tem pedido de consulta esperando resposta.` };
  const text = cleanText(input.text, CHAT_MESSAGE_MAX + 1);
  if (text.length > CHAT_MESSAGE_MAX) return { ok: false, status: 422, speech: 'O recado ficou longo demais para o chat. Resuma em poucas frases.' };
  const withMessage = text.length >= 2;

  await Promise.all(open.map((request) => db.collection('appointmentRequests').doc(request.id)
    .set({ status: 'declined', answeredAt: now.toISOString() }, { merge: true })));
  if (withMessage) await postChatMessage(db, nutritionistId, patient.uid, text, now);
  return {
    ok: true,
    speech: `Pedido de consulta de ${patient.name} encerrado. `
      + (withMessage ? 'O recado foi enviado no chat do aplicativo.' : 'No aplicativo, o paciente vê que o pedido não pôde ser atendido.'),
    request: { patientName: patient.name, status: 'declined', messageSent: withMessage },
  };
}

/** Anotação feita por voz: limite menor que o da tela, para caber no que a Ali consegue repetir antes de salvar. */
const NOTE_BY_VOICE_MAX = 2000;

export interface NoteInput { patientName?: unknown; text?: unknown }

/** Anotação da consulta no prontuário de um paciente dela. Só ela vê; o paciente não tem acesso. */
export async function addConsultationNote(db: Firestore, nutritionistId: string, input: NoteInput, now = new Date()): Promise<ActionResult> {
  const picked = pickOne(await loadPatients(db, nutritionistId), input.patientName, 'do paciente');
  if (!picked.ok) return picked.result;
  const patient = picked.value;
  const text = cleanNote(input.text);
  if (text.length < 3) return { ok: false, status: 422, speech: 'O que você quer anotar?' };
  if (text.length > NOTE_BY_VOICE_MAX) return { ok: false, status: 422, speech: 'A anotação ficou longa demais para registrar por voz. Divida em partes ou escreva na tela do paciente.' };
  const note = await saveNote(db, nutritionistId, patient.uid, text, 'ali', now);
  return { ok: true, speech: `Anotação salva no prontuário de ${patient.name}. Só você vê as anotações das consultas.`, note: { patientName: patient.name, createdAt: note.createdAt } };
}

export async function consultationNotes(db: Firestore, nutritionistId: string, patientName: unknown): Promise<ActionResult> {
  const picked = pickOne(await loadPatients(db, nutritionistId), patientName, 'do paciente');
  if (!picked.ok) return picked.result;
  const patient = picked.value;
  const [notes, settings] = await Promise.all([listNotesFor(db, nutritionistId, patient.uid, 3), loadSettings(db, nutritionistId)]);
  if (!notes.length) return { ok: true, speech: `Você ainda não tem anotações de consulta de ${patient.name}.`, notes: [] };
  const spoken = notes.map((note) => `Em ${noteDay(note.createdAt, settings.timezone)}: ${withPeriod(clipSpoken(note.text, 400))}`);
  return {
    ok: true,
    speech: `${notes.length === 1 ? 'Última anotação' : `Últimas ${notes.length} anotações`} de ${patient.name}. ${spoken.join(' ')}`,
    notes: notes.map((note) => ({ createdAt: note.createdAt, text: clipSpoken(note.text, 400) })),
  };
}

interface UpcomingConsultation { patientUid: string; patientName: string; start: number; label: string }

/**
 * Próxima consulta marcada: as da Ali (com o paciente certo) e as marcadas à mão no app que têm o paciente ligado.
 * Com patientUid, só as desse paciente. Uma consulta em andamento ainda conta até o horário de terminar.
 */
async function nextConsultation(db: Firestore, nutritionistId: string, now: Date, timeZone: string, patientUid?: string): Promise<UpcomingConsultation | null> {
  const [aliSnap, userSnap] = await Promise.all([
    db.collection(APPOINTMENTS_COLLECTION).where('nutritionistId', '==', nutritionistId).where('status', '==', 'scheduled').get(),
    db.collection('users').doc(nutritionistId).get(),
  ]);
  const found: UpcomingConsultation[] = aliSnap.docs
    .map((doc) => doc.data() || {})
    .filter((r) => typeof r.patientUid === 'string' && typeof r.startAt === 'string' && Date.parse(typeof r.endAt === 'string' ? r.endAt : r.startAt) > now.getTime())
    .map((r) => ({ patientUid: r.patientUid, patientName: cleanText(r.patientName, 120), start: Date.parse(r.startAt), label: cleanText(r.label, 120) || slotLabel(new Date(r.startAt), timeZone) }));
  const listed = userSnap.exists ? userSnap.data()?.appointments : [];
  for (const a of Array.isArray(listed) ? listed : []) {
    if (!a || a.source !== 'manual' || a.status !== 'Agendada' || typeof a.patientUid !== 'string') continue;
    const start = parseLocalDateTime(a.date, a.time, timeZone);
    if (start && start.getTime() + 60 * 60_000 > now.getTime()) found.push({ patientUid: a.patientUid, patientName: cleanText(a.patientName, 120), start: start.getTime(), label: slotLabel(start, timeZone) });
  }
  const mine = found.filter((c) => !patientUid || c.patientUid === patientUid).sort((a, b) => a.start - b.start);
  return mine[0] || null;
}

const BRIEF_DAYS = 14;

/**
 * Resumo para a nutricionista ler antes da consulta: peso e meta, o que o paciente registrou nas duas últimas semanas,
 * água e humor de hoje, último acesso, plano, pedido aberto e a última anotação. Sem nome, usa a próxima consulta marcada.
 */
export async function consultationBrief(db: Firestore, nutritionistId: string, patientName: unknown, lastSeen: LastSeenLookup, now = new Date()): Promise<ActionResult> {
  const tz = (await loadSettings(db, nutritionistId)).timezone;
  const patients = await loadPatients(db, nutritionistId);
  let patient: PatientRow;
  let consultation: UpcomingConsultation | null;
  if (cleanText(patientName, 120)) {
    const picked = pickOne(patients, patientName, 'do paciente');
    if (!picked.ok) return picked.result;
    patient = picked.value;
    consultation = await nextConsultation(db, nutritionistId, now, tz, patient.uid);
  } else {
    consultation = await nextConsultation(db, nutritionistId, now, tz);
    const found = consultation ? patients.find((row) => row.uid === consultation?.patientUid) : undefined;
    if (!found) return { ok: false, status: 404, speech: 'Não encontrei a próxima consulta marcada. De qual paciente você quer o resumo?' };
    patient = found;
  }

  const since = new Date(now.getTime() - BRIEF_DAYS * ONE_DAY_MS);
  const ref = db.collection('patients').doc(patient.uid);
  const [snap, profileSnap, logsSnap, notes, requests, seen] = await Promise.all([
    ref.get(),
    db.collection('users').doc(patient.uid).get(),
    ref.collection('foodLogs').where('loggedAt', '>=', since.toISOString()).get(),
    listNotesFor(db, nutritionistId, patient.uid, 1),
    pendingRequests(db, nutritionistId),
    lastSeen([patient.uid]).catch(() => null),
  ]);
  const data = snap.exists ? snap.data() || {} : {};
  const profile = profileSnap.exists ? profileSnap.data() || {} : {};
  const parts = [`Resumo de ${patient.name}, ${consultation ? `com consulta marcada para ${consultation.label}` : 'sem consulta marcada'}.`];
  if (patient.objective) parts.push(`Objetivo: ${patient.objective}.`);

  // Peso: a última medição, a mudança desde a anterior e quanto falta para a meta.
  const measures = measurementsOf(data);
  const last = measures.length ? measures[measures.length - 1] : null;
  const previous = measures.length > 1 ? measures[measures.length - 2] : null;
  const target = patient.targetWeight;
  const current = last ? last.weight : patient.weight;
  const change = last && previous ? Math.round((last.weight - previous.weight) * 10) / 10 : null;
  if (current !== null) {
    const gap = target === null ? null : Math.round(Math.abs(current - target) * 10) / 10;
    parts.push(`${last ? `Peso atual ${spokenKilos(last.weight)}, de ${dateKeyLabel(last.date)}` : `Peso informado ${spokenKilos(current)}`}`
      + (change === null || !previous ? '' : change === 0 ? `, igual à medição de ${dateKeyLabel(previous.date)}` : `; ${change > 0 ? 'subiu' : 'desceu'} ${spokenKilos(Math.abs(change))} desde ${dateKeyLabel(previous.date)}`)
      + (gap === null ? '' : gap === 0 ? '; a meta foi atingida' : `; faltam ${spokenKilos(gap)} para a meta de ${spokenKilos(target as number)}`) + '.');
  }

  // O que ele registrou com a Ali nas duas últimas semanas.
  const logs = logsSnap.docs
    .map((doc) => doc.data() || {})
    .filter((log) => typeof log.loggedAt === 'string')
    .sort((a, b) => String(b.loggedAt).localeCompare(String(a.loggedAt)));
  const mealDays = new Set(logs.map((log) => localDateKey(new Date(log.loggedAt), tz))).size;
  parts.push(logs.length
    ? `Nos últimos ${BRIEF_DAYS} dias, ${logs.length} ${logs.length === 1 ? 'refeição anotada' : 'refeições anotadas'} pela Ali, em ${mealDays} ${mealDays === 1 ? 'dia' : 'dias'}`
      + (typeof logs[0].description === 'string' && logs[0].description.trim() ? `; a mais recente: ${clipSpoken(logs[0].description, 120)}.` : '.')
    : `Nos últimos ${BRIEF_DAYS} dias, nenhuma refeição anotada pela Ali.`);

  const water = waterToday(profile.waterIntake, now);
  const mood = moodToday(profile.moodDiary, now);
  const today = [water ? `${water} ml de água` : '', mood ? `humor ${MOOD_LABELS[mood]}` : ''].filter(Boolean);
  if (today.length) parts.push(`Hoje: ${joinPt(today)}.`);

  // Último acesso: só para quem tem login; sem a informação, a frase fica de fora.
  let awayDays: number | null = null;
  let neverSeen = false;
  if (seen && seen.has(patient.uid)) {
    const at = seen.get(patient.uid);
    if (!at) {
      neverSeen = true;
      parts.push('Ainda não entrou no aplicativo.');
    } else {
      awayDays = Math.max(0, Math.floor((now.getTime() - at.getTime()) / ONE_DAY_MS));
      parts.push(awayDays === 0 ? 'Abriu o aplicativo nas últimas 24 horas.' : awayDays === 1 ? 'Abriu o aplicativo ontem.' : `Está há ${awayDays} dias sem abrir o aplicativo.`);
    }
  }
  parts.push(patient.plan === 'approved' ? 'Plano alimentar aprovado.' : patient.plan === 'draft' ? 'Plano em rascunho, esperando a sua aprovação.' : 'Ainda sem plano alimentar.');
  const openRequest = requests.find((request) => request.patientUid === patient.uid) || null;
  if (openRequest) parts.push(`Tem um pedido de consulta aberto, ${preference(openRequest.preferredDate)}.`);
  const lastNote = notes[0] || null;
  parts.push(lastNote ? `Última anotação de consulta, de ${noteDay(lastNote.createdAt, tz)}: ${withPeriod(clipSpoken(lastNote.text, 300))}` : 'Ainda não há anotações de consulta.');

  return {
    ok: true,
    speech: parts.join(' '),
    brief: {
      patientName: patient.name, consultation: consultation ? consultation.label : null, objective: patient.objective || null,
      weight: current, previousWeight: previous ? previous.weight : null, targetWeight: target, mealsLogged: logs.length, mealDays,
      waterToday: water, moodToday: mood, awayDays, neverSeen, plan: patient.plan, openRequest: openRequest ? openRequest.preferredDate : null,
      lastNote: lastNote ? { createdAt: lastNote.createdAt, text: clipSpoken(lastNote.text, 300) } : null,
    },
  };
}

/** A partir de quantos dias sem abrir o app o paciente entra na lista de atenção (o mesmo do resumo da semana). */
const ATTENTION_AWAY_DAYS = 7;
/** Quantos dias sem nenhum registro (refeição pela Ali ou peso) contam como paciente parado. */
const ATTENTION_QUIET_DAYS = 14;
/** Só olha a mudança de peso quando a última medição é recente. */
const ATTENTION_WEIGHT_DAYS = 30;

/**
 * Pacientes que pedem atenção, do mais urgente ao menos urgente, com os motivos: pedido de consulta aberto,
 * humor triste hoje, peso se afastando da meta, sumido do app, parado sem registros, plano esperando aprovação ou sem plano.
 */
export async function attentionList(db: Firestore, nutritionistId: string, lastSeen: LastSeenLookup, now = new Date()): Promise<ActionResult> {
  const tz = (await loadSettings(db, nutritionistId)).timezone;
  const snap = await db.collection('patients').where('nutritionistId', '==', nutritionistId).get();
  const docs = snap.docs.filter((doc) => typeof doc.data()?.name === 'string' && doc.data().name.trim());
  if (!docs.length) return { ok: true, speech: 'Você ainda não tem pacientes vinculados no NutriAli.', attention: [] };
  const [requests, seen] = await Promise.all([pendingRequests(db, nutritionistId), lastSeen(docs.map((doc) => doc.id)).catch(() => null)]);
  const quietSince = new Date(now.getTime() - ATTENTION_QUIET_DAYS * ONE_DAY_MS);
  const quietKey = localDateKey(quietSince, tz);
  const weightKey = localDateKey(new Date(now.getTime() - ATTENTION_WEIGHT_DAYS * ONE_DAY_MS), tz);

  const rows = await Promise.all(docs.map(async (doc) => {
    const d = doc.data() || {};
    const reasons: { text: string; weight: number }[] = [];
    const request = requests.find((item) => item.patientUid === doc.id);
    if (request) reasons.push({ weight: 3, text: `pediu consulta, ${preference(request.preferredDate)}` });
    const profile = await db.collection('users').doc(doc.id).get();
    if (moodToday(profile.exists ? profile.data()?.moodDiary : null, now) === 'sad') reasons.push({ weight: 3, text: 'marcou hoje que não está bem' });

    const measures = measurementsOf(d);
    const last = measures.length ? measures[measures.length - 1] : null;
    const previous = measures.length > 1 ? measures[measures.length - 2] : null;
    const target = typeof d.targetWeight === 'number' ? d.targetWeight : null;
    if (last && previous && target !== null && last.date >= weightKey) {
      const drift = Math.abs(last.weight - target) - Math.abs(previous.weight - target);
      if (drift >= 0.5) reasons.push({ weight: 2, text: `o peso ${last.weight > previous.weight ? 'subiu' : 'desceu'} ${spokenKilos(Math.round(Math.abs(last.weight - previous.weight) * 10) / 10)} na última medição, se afastando da meta` });
    }

    // Acesso e registros: só para quem tem login; sem a informação, esses motivos ficam de fora.
    if (seen && seen.has(doc.id)) {
      const at = seen.get(doc.id);
      if (!at) reasons.push({ weight: 2, text: 'ainda não entrou no aplicativo' });
      else {
        const days = Math.floor((now.getTime() - at.getTime()) / ONE_DAY_MS);
        if (days >= ATTENTION_AWAY_DAYS) reasons.push({ weight: 2, text: `está há ${days} dias sem abrir o aplicativo` });
        const logs = await doc.ref.collection('foodLogs').where('loggedAt', '>=', quietSince.toISOString()).get();
        if (!logs.docs.length && !(last && last.date >= quietKey)) reasons.push({ weight: 1, text: 'não registrou refeição nem peso nas últimas duas semanas' });
      }
    }
    const status = d.currentPlan?.status;
    if (status && status !== 'approved') reasons.push({ weight: 2, text: 'o plano está esperando a sua aprovação' });
    else if (!status) reasons.push({ weight: 1, text: 'ainda não tem plano alimentar' });
    reasons.sort((a, b) => b.weight - a.weight);
    return { name: String(d.name).trim(), reasons, score: reasons.reduce((sum, reason) => sum + reason.weight, 0) };
  }));

  const flagged = rows.filter((row) => row.reasons.length).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'pt-BR'));
  if (!flagged.length) return { ok: true, speech: 'Ninguém precisa de atenção especial agora.', attention: [] };
  const spoken = flagged.slice(0, 5).map((row) => `${row.name}: ${joinPt(row.reasons.map((reason) => reason.text))}.`);
  const rest = flagged.slice(5);
  return {
    ok: true,
    speech: `${flagged.length === 1 ? 'Um paciente precisa' : `${flagged.length} pacientes precisam`} de atenção. ${spoken.join(' ')}`
      + (rest.length ? ` Também: ${joinPt(rest.slice(0, 5).map((row) => row.name))}${rest.length > 5 ? ` e mais ${rest.length - 5}` : ''}.` : ''),
    attention: flagged.slice(0, 20).map((row) => ({ name: row.name, reasons: row.reasons.map((reason) => reason.text) })),
  };
}

interface Person { name: string; email: string | null }

/** Pacientes dela e contatos salvos na Minha Ali: os únicos destinos que a Ali aceita. */
async function loadPeople(db: Firestore, nutritionistId: string): Promise<Person[]> {
  const [patients, contacts] = await Promise.all([loadPatients(db, nutritionistId), loadContacts(db, nutritionistId)]);
  return [...patients.map((patient) => ({ name: patient.name, email: patient.email })), ...contacts];
}

export interface EventInput { title?: unknown; date?: unknown; time?: unknown; durationMinutes?: unknown; guest?: unknown; online?: unknown; notes?: unknown; force?: unknown }

/** Compromisso livre na agenda (reunião, visita, lembrete), com convidado e Meet opcionais. */
export async function createEvent(db: Firestore, nutritionistId: string, input: EventInput, now = new Date()): Promise<ActionResult> {
  const title = cleanText(input.title, 120);
  if (!title) return { ok: false, status: 422, speech: 'Qual é o título do compromisso?' };
  const minutes = typeof input.durationMinutes === 'number' && Number.isInteger(input.durationMinutes) && input.durationMinutes >= 15 && input.durationMinutes <= 480 ? input.durationMinutes : 60;
  let guest: Person | null = null;
  if (cleanText(input.guest, 120)) {
    const picked = pickOne(await loadPeople(db, nutritionistId), input.guest, 'do convidado');
    if (!picked.ok) return picked.result;
    if (!picked.value.email) return { ok: false, status: 422, speech: `${picked.value.name} não tem e-mail cadastrado. Quer marcar sem enviar convite?` };
    guest = picked.value;
  }
  const access = await getAccess(db, nutritionistId);
  if (!access.ok) return accessProblem(access.reason);
  const tz = (await loadSettings(db, nutritionistId)).timezone;
  const timing = readTiming(input.date, input.time, minutes, tz, now);
  if (!timing.ok) return timing.result;
  const conflict = await conflictWarning(access.token, timing.start, timing.end, tz, input.force);
  if (conflict) return conflict;

  const notes = cleanText(input.notes, 1000);
  const online = input.online === true;
  const res = await googleRequest(access.token, 'POST', `${CALENDAR_EVENTS_URL}?conferenceDataVersion=1&sendUpdates=${guest ? 'all' : 'none'}`, {
    summary: title,
    description: `${notes ? `${notes}\n\n` : ''}Criado pela Ali (NutriAli).`,
    start: { dateTime: toOffsetIso(timing.start, tz), timeZone: tz },
    end: { dateTime: toOffsetIso(timing.end, tz), timeZone: tz },
    reminders: { useDefault: true },
    ...(guest ? { attendees: [{ email: guest.email, displayName: guest.name }] } : {}),
    ...(online ? { conferenceData: { createRequest: { requestId: newNonce(), conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
  }).catch(() => null);
  if (!res || !res.ok) return { ok: false, status: 502, speech: 'Não consegui criar o compromisso na agenda agora. Nada foi marcado. Tente de novo em instantes.' };
  const label = slotLabel(timing.start, tz);
  return {
    ok: true,
    speech: `Pronto! Marquei ${title} para ${label}${guest ? `, com convite para ${guest.name}` : ''}${online ? '. O link do Meet está no evento da agenda' : ''}.`,
    event: { title, label, start: toOffsetIso(timing.start, tz), guest: guest?.name || null },
  };
}

// ───────────── E-mail ─────────────

function bodyToHtml(text: string): string {
  return text.split(/\n{2,}/).map((block) => p(escapeHtml(block).replace(/\n/g, '<br>'))).join('');
}

export interface EmailInput { to?: unknown; subject?: unknown; body?: unknown }

/** E-mail pelo Gmail da nutricionista, só para pacientes dela e contatos salvos, com limite diário. */
export async function sendEmail(db: Firestore, nutritionistId: string, input: EmailInput, now = new Date()): Promise<ActionResult> {
  const picked = pickOne(await loadPeople(db, nutritionistId), input.to, 'de quem vai receber');
  if (!picked.ok) return picked.result;
  const recipient = picked.value;
  if (!recipient.email) return { ok: false, status: 422, speech: `${recipient.name} não tem e-mail cadastrado.` };
  const subject = cleanText(input.subject, 150).replace(/\s+/g, ' ');
  const body = cleanText(input.body, 4000);
  if (!subject) return { ok: false, status: 422, speech: 'Qual é o assunto do e-mail?' };
  if (body.length < 3) return { ok: false, status: 422, speech: 'O que você quer dizer no e-mail?' };

  const access = await getAccess(db, nutritionistId);
  if (!access.ok) return accessProblem(access.reason);
  const settings = await loadSettings(db, nutritionistId);
  const usageRef = db.collection('aliUsage').doc(nutritionistId);
  const today = localDateKey(now, settings.timezone);
  const usageSnap = await usageRef.get();
  const usage = usageSnap.exists ? usageSnap.data() || {} : {};
  const sentToday = usage.day === today && typeof usage.emails === 'number' ? usage.emails : 0;
  if (sentToday >= DAILY_EMAIL_LIMIT) {
    return { ok: false, status: 429, speech: `Você chegou ao limite de ${DAILY_EMAIL_LIMIT} e-mails por dia pela Ali. Amanhã libera de novo.` };
  }

  const sender = settings.displayName || 'NutriAli';
  try {
    await sendMail(access.token, {
      fromName: sender, fromEmail: access.email, to: recipient.email, subject,
      html: emailLayout(subject, bodyToHtml(body), `Enviado por ${escapeHtml(sender)} pelo NutriAli.`),
    });
  } catch {
    return { ok: false, status: 502, speech: 'Não consegui enviar o e-mail agora. Nada foi enviado. Tente de novo em instantes.' };
  }
  await usageRef.set({ day: today, emails: sentToday + 1, updatedAt: now.toISOString() });
  return { ok: true, speech: `E-mail enviado para ${recipient.name}.`, email: { to: recipient.name, subject } };
}

export async function listContacts(db: Firestore, nutritionistId: string): Promise<ActionResult> {
  const contacts = await loadContacts(db, nutritionistId);
  if (!contacts.length) return { ok: true, speech: 'Você ainda não salvou contatos. Dá para adicionar na página Minha Ali.', contacts: [] };
  return { ok: true, speech: `Você tem ${contacts.length} ${contacts.length === 1 ? 'contato salvo' : 'contatos salvos'}: ${joinPt(contacts.slice(0, 12).map((c) => c.name))}.`, contacts: contacts.map((c) => c.name) };
}

// ───────────── Contexto para a conversa ─────────────

/** Informações que a Ali da nutricionista recebe no começo da conversa (sem dados de pacientes). */
export async function assistantContext(db: Firestore, nutritionistId: string, now = new Date()): Promise<Record<string, string>> {
  const [settings, google, patients] = await Promise.all([
    loadSettings(db, nutritionistId),
    connectionStatus(db, nutritionistId),
    db.collection('patients').where('nutritionistId', '==', nutritionistId).get(),
  ]);
  return {
    nutritionistName: settings.displayName || 'nutricionista',
    patientCount: String(patients.docs.length),
    attendanceInfo: describeAttendance(settings),
    clinicInfo: describeClinic(settings) || 'Nenhuma informação do consultório cadastrada.',
    googleStatus: google.connected ? 'conectado' : 'nao_conectado',
    dateInfo: describeDates(now, settings.timezone),
  };
}
