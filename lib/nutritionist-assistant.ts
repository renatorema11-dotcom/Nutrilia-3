// Ali da nutricionista: pacientes, agenda e e-mails da própria nutricionista. Somente no servidor.
// Cada função recebe o uid já conferido pela rota e só enxerga os dados dessa nutricionista.
import type { Firestore } from 'firebase-admin/firestore';
import { cleanText, describeAttendance, describeClinic, joinPt, matchByName, sanitizeContacts } from './ali-settings';
import type { AliContact } from './ali-settings';
import { describeDates, isFree, localDateKey, parseLocalDateTime, slotLabel, toOffsetIso } from './agenda';
import type { Interval } from './agenda';
import { cancelNextByNutritionist, rescheduleNextByNutritionist } from './appointments';
import { CALENDAR_EVENTS_URL, busyIntervals, connectionStatus, createAppointment, emailLayout, escapeHtml, getAccess, googleRequest, isValidEmail, loadSettings, newNonce, p, sendMail, sendPlanEmail } from './google-workspace';
import type { ActionResult } from './google-workspace';
import { collectWeek } from './weekly-report';
import type { LastSeenLookup } from './weekly-report';

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
  return createAppointment(db, access, settings, {
    nutritionistId, patientUid: patient.uid, patientName: patient.name, patientEmail: patient.email,
    start: timing.start, end: timing.end, mode, notes: cleanText(input.notes, 500), bookedBy: 'nutritionist',
  }, now);
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

  const settings = await loadSettings(db, nutritionistId);
  // Mesmo endereço e mesmo formato das mensagens que ela escreve na tela "Chat com Pacientes".
  const chat = db.collection('chats').doc(`${patient.uid}_${nutritionistId}`);
  await chat.set({ updatedAt: now }, { merge: true });
  await chat.collection('messages').add({
    senderId: nutritionistId, senderName: settings.displayName || 'Nutricionista', senderRole: 'nutritionist', text, createdAt: now.toISOString(),
  });
  return { ok: true, speech: `Recado enviado para ${patient.name} no chat do aplicativo.`, message: { to: patient.name } };
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
