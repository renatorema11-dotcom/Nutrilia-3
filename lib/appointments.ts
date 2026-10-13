// Consultas marcadas pela Ali: cancelamento, remarcação e lembretes por e-mail. Somente no servidor.
// O registro de cada consulta fica em aliAppointments (gravado em bookAppointment).
import { FieldValue, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import type { AliSettings } from './ali-settings';
import { dueReminders, initialReminders, isFree, slotLabel, toOffsetIso, validateSlotStart, withoutInterval, type Interval, type ReminderKind } from './agenda';
import { APPOINTMENTS_COLLECTION, CALENDAR_EVENTS_URL, appointmentDocId, busyIntervals, emailLayout, escapeHtml, getAccess, googleRequest, loadSettings, p, sendMail } from './google-workspace';
import type { ActionResult, AppointmentRecord } from './google-workspace';

type StoredAppointment = AppointmentRecord & { ref: DocumentReference };

const NO_APPOINTMENT = 'Não encontrei nenhuma consulta marcada pela Ali no seu nome.';

/** Consultas futuras do paciente, da mais próxima para a mais distante. */
async function upcomingForPatient(db: Firestore, patientUid: string, now: Date): Promise<StoredAppointment[]> {
  const snap = await db.collection(APPOINTMENTS_COLLECTION).where('patientUid', '==', patientUid).get();
  return snap.docs
    .map((doc) => ({ ...(doc.data() as AppointmentRecord), ref: doc.ref }))
    .filter((a) => a.status === 'scheduled' && Date.parse(a.startAt) > now.getTime())
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/** Atualiza a consulta nas listas que o app mostra para o paciente e para a nutricionista. */
async function patchListEntry(db: Firestore, uid: string, eventId: string, patch: Record<string, unknown>) {
  const ref = db.collection('users').doc(uid);
  const snap = await ref.get();
  const list = snap.exists ? snap.data()?.appointments : null;
  if (!Array.isArray(list) || !list.some((a) => a?.id === eventId)) return;
  await ref.set({ appointments: list.map((a) => (a?.id === eventId ? { ...a, ...patch } : a)) }, { merge: true });
}

async function refreshNextAppointment(db: Firestore, patientUid: string, now: Date) {
  const [next] = await upcomingForPatient(db, patientUid, now);
  await db.collection('patients').doc(patientUid).set(
    next ? { nextAppointment: next.label, nextAppointmentAt: next.startLocal } : { nextAppointment: '', nextAppointmentAt: FieldValue.delete() },
    { merge: true },
  );
}

/** Marca a consulta como cancelada no app (a agenda do Google já foi tratada por quem chamou). */
async function markCancelled(db: Firestore, a: StoredAppointment, now: Date) {
  await a.ref.update({ status: 'cancelled', updatedAt: now.toISOString() });
  await Promise.all([
    patchListEntry(db, a.patientUid, a.eventId, { status: 'Cancelada' }),
    patchListEntry(db, a.nutritionistId, a.eventId, { status: 'Cancelada' }),
  ]);
  await refreshNextAppointment(db, a.patientUid, now);
}

/** Grava o novo horário no registro e nas listas do app; os lembretes recomeçam do zero. */
async function applyNewTime(db: Firestore, a: StoredAppointment, start: Date, end: Date, timeZone: string, now: Date): Promise<StoredAppointment> {
  const startLocal = toOffsetIso(start, timeZone);
  const changes = {
    startAt: start.toISOString(), endAt: end.toISOString(), startLocal, label: slotLabel(start, timeZone),
    reminders: initialReminders(start, now), updatedAt: now.toISOString(),
  };
  await a.ref.update(changes);
  const [date, time] = startLocal.split('T');
  const entry = { date, time: time.slice(0, 5) };
  await Promise.all([patchListEntry(db, a.patientUid, a.eventId, entry), patchListEntry(db, a.nutritionistId, a.eventId, entry)]);
  await refreshNextAppointment(db, a.patientUid, now);
  return { ...a, ...changes };
}

function whereLine(a: AppointmentRecord, settings: AliSettings): string {
  if (a.mode === 'presencial') return settings.address ? `Endereço: ${escapeHtml(settings.address)}` : 'Consulta presencial.';
  return a.meetLink ? `Link da chamada: <a href="${escapeHtml(a.meetLink)}" style="color:#276e58">${escapeHtml(a.meetLink)}</a>` : 'Consulta online.';
}

const eventUrl = (a: AppointmentRecord) => `${CALENDAR_EVENTS_URL}/${encodeURIComponent(a.eventId)}`;
const notifyGuests = (a: AppointmentRecord) => `sendUpdates=${a.patientEmail ? 'all' : 'none'}`;

async function cancelStored(db: Firestore, a: StoredAppointment, by: 'patient' | 'nutritionist', now: Date): Promise<ActionResult> {
  const access = await getAccess(db, a.nutritionistId);
  if (!access.ok) {
    return { ok: false, status: access.reason === 'unavailable' ? 502 : 409,
      speech: 'Não consegui acessar a agenda agora, então a consulta continua marcada. Tente de novo em instantes ou fale pelo chat do aplicativo.' };
  }
  const res = await googleRequest(access.token, 'DELETE', `${eventUrl(a)}?${notifyGuests(a)}`).catch(() => null);
  // 404 e 410: o evento já tinha sido apagado direto na agenda.
  if (!res || (!res.ok && res.status !== 404 && res.status !== 410)) {
    return { ok: false, status: 502, speech: 'Não consegui cancelar na agenda agora. A consulta continua marcada. Tente de novo em instantes.' };
  }
  await markCancelled(db, a, now);

  const settings = await loadSettings(db, a.nutritionistId);
  const nutriName = settings.displayName || 'sua nutricionista';
  try {
    if (by === 'patient') {
      await sendMail(access.token, {
        fromName: 'Ali — NutriAli', fromEmail: access.email, to: access.email,
        subject: `Consulta cancelada pelo paciente: ${a.patientName} — ${a.label}`,
        html: emailLayout('Consulta cancelada pelo paciente', [
          p(`<strong>Paciente:</strong> ${escapeHtml(a.patientName)}`),
          p(`<strong>Era em:</strong> ${escapeHtml(a.label)}`),
          p('O horário já foi liberado na sua agenda do Google.'),
        ].join(''), 'Aviso automático do NutriAli.'),
      });
    } else if (a.patientEmail) {
      await sendMail(access.token, {
        fromName: settings.displayName || 'NutriAli', fromEmail: access.email, to: a.patientEmail,
        subject: `Consulta cancelada: ${a.label}`,
        html: emailLayout('Sua consulta foi cancelada', [
          p(`Olá, ${escapeHtml(a.patientName)}!`),
          p(`Sua consulta com ${escapeHtml(nutriName)} de <strong>${escapeHtml(a.label)}</strong> foi cancelada.`),
          p('Para marcar um novo horário, é só pedir para a Ali no aplicativo.'),
        ].join(''), 'Aviso automático do NutriAli.'),
      });
    }
  } catch {
    console.error('Ali: falha ao avisar o cancelamento.');
  }

  return {
    ok: true,
    speech: by === 'patient'
      ? `Pronto, cancelei a sua consulta de ${a.label}. O horário foi liberado e eu avisei ${nutriName}. Quer marcar outro horário?`
      : `Consulta de ${a.patientName} de ${a.label} cancelada. O horário foi liberado na agenda do Google${a.patientEmail ? ' e o paciente foi avisado por e-mail' : ''}.`,
    appointment: { label: a.label, start: a.startLocal, status: 'cancelled' },
  };
}

/** Pedido da nutricionista à Ali dela: cancela a próxima consulta que ela tem com esse paciente. */
export async function cancelNextByNutritionist(db: Firestore, nutritionistId: string, patientUid: string, now = new Date()): Promise<ActionResult> {
  const next = (await upcomingForPatient(db, patientUid, now)).find((a) => a.nutritionistId === nutritionistId);
  if (!next) return { ok: false, status: 409, speech: 'Não encontrei consulta marcada pela Ali com esse paciente.' };
  return cancelStored(db, next, 'nutritionist', now);
}

/** Pedido por voz: cancela a próxima consulta do paciente. */
/**
 * A nutricionista troca o horário da próxima consulta de um paciente dela. Ela escolhe o horário que quiser
 * (não precisa caber na grade de atendimento); se bater com outro compromisso, a Ali avisa e só segue com force.
 * A consulta continua com a mesma duração, os lembretes recomeçam e o paciente é avisado.
 */
export async function rescheduleNextByNutritionist(db: Firestore, nutritionistId: string, patientUid: string, start: Date, force: boolean, now = new Date()): Promise<ActionResult> {
  const current = (await upcomingForPatient(db, patientUid, now)).find((a) => a.nutritionistId === nutritionistId);
  if (!current) return { ok: false, status: 409, speech: 'Não encontrei consulta marcada pela Ali com esse paciente. Quer que eu marque uma nova?' };
  const access = await getAccess(db, nutritionistId);
  if (!access.ok) {
    return access.reason === 'unavailable'
      ? { ok: false, status: 502, speech: 'Não consegui falar com o Google agora, então a consulta continua no horário de antes. Tente de novo em instantes.' }
      : { ok: false, status: 409, speech: 'A sua conta do Google não está conectada à Ali. Entre em Minha Ali e clique em Conectar Google.' };
  }
  const settings = await loadSettings(db, nutritionistId);
  const tz = settings.timezone;
  const previous: Interval = { start: new Date(current.startAt), end: new Date(current.endAt) };
  if (start.getTime() === previous.start.getTime()) return { ok: false, status: 409, speech: `A consulta de ${current.patientName} já está marcada para ${current.label}.` };
  const end = new Date(start.getTime() + (previous.end.getTime() - previous.start.getTime()));

  if (!force) {
    let busy: Interval[];
    try { busy = await busyIntervals(access.token, { start: new Date(start.getTime() - 3_600_000), end: new Date(end.getTime() + 3_600_000) }, tz); }
    catch { return { ok: false, status: 502, speech: 'Não consegui ver a sua agenda agora. Tente de novo em instantes.' }; }
    // O horário de antes não conta como ocupado: é a própria consulta que está mudando de lugar.
    if (!isFree(start, end, withoutInterval(busy, previous), 0)) {
      return { ok: false, status: 409, speech: 'Você já tem um compromisso nesse horário. Quer remarcar mesmo assim?' };
    }
  }

  const res = await googleRequest(access.token, 'PATCH', `${eventUrl(current)}?${notifyGuests(current)}`, {
    start: { dateTime: toOffsetIso(start, tz), timeZone: tz },
    end: { dateTime: toOffsetIso(end, tz), timeZone: tz },
  }).catch(() => null);
  if (res && (res.status === 404 || res.status === 410)) {
    await markCancelled(db, current, now);
    return { ok: false, status: 409, speech: 'Essa consulta não está mais na sua agenda do Google. Quer que eu marque uma nova?' };
  }
  if (!res || !res.ok) {
    return { ok: false, status: 502, speech: 'Não consegui remarcar na agenda agora. A consulta continua no horário de antes. Tente de novo em instantes.' };
  }
  const updated = await applyNewTime(db, current, start, end, tz, now);

  let patientMailed = false;
  if (updated.patientEmail) {
    try {
      await sendMail(access.token, {
        fromName: settings.displayName || 'NutriAli', fromEmail: access.email, to: updated.patientEmail,
        subject: `Consulta remarcada: ${updated.label}`,
        html: emailLayout('Sua consulta foi remarcada', [
          p(`Olá, ${escapeHtml(updated.patientName)}!`),
          p(`${escapeHtml(settings.displayName || 'Sua nutricionista')} remarcou a sua consulta para <strong>${escapeHtml(updated.label)}</strong>. O horário de antes era ${escapeHtml(current.label)}.`),
          p(whereLine(updated, settings)),
          p('Se esse horário não servir, peça outro para a Ali no aplicativo.'),
        ].join(''), 'Consulta remarcada pela Ali, a assistente do NutriAli.'),
      });
      patientMailed = true;
    } catch {
      console.error('Ali: falha ao enviar a remarcação ao paciente.');
    }
  }
  return {
    ok: true,
    speech: `Pronto! Remarquei a consulta de ${updated.patientName} para ${updated.label}. `
      + (patientMailed ? 'O paciente foi avisado por e-mail.' : updated.patientEmail ? 'O convite atualizado chega pela agenda do Google.' : 'O paciente não tem e-mail cadastrado: avise o novo horário por outro meio.'),
    appointment: { patientName: updated.patientName, label: updated.label, start: updated.startLocal, mode: updated.mode },
  };
}

export async function cancelNextAppointment(db: Firestore, patientUid: string, now = new Date()): Promise<ActionResult> {
  const [next] = await upcomingForPatient(db, patientUid, now);
  if (!next) return { ok: false, status: 409, speech: `${NO_APPOINTMENT} Quer que eu veja os horários livres para marcar uma?` };
  return cancelStored(db, next, 'patient', now);
}

/** Botão de cancelar do app: quem pede precisa ser o paciente ou a nutricionista da consulta. */
export async function cancelAppointmentById(db: Firestore, caller: { uid: string; role: 'patient' | 'nutritionist' }, eventId: string, now = new Date()): Promise<ActionResult> {
  let found: StoredAppointment | undefined;
  if (caller.role === 'nutritionist') {
    const doc = await db.collection(APPOINTMENTS_COLLECTION).doc(appointmentDocId(caller.uid, eventId)).get();
    if (doc.exists) found = { ...(doc.data() as AppointmentRecord), ref: doc.ref };
  } else {
    const snap = await db.collection(APPOINTMENTS_COLLECTION).where('patientUid', '==', caller.uid).get();
    const doc = snap.docs.find((d) => d.data().eventId === eventId);
    if (doc) found = { ...(doc.data() as AppointmentRecord), ref: doc.ref };
  }
  if (!found) return { ok: false, status: 404, speech: 'Consulta não encontrada.' };
  if (found.status !== 'scheduled') return { ok: true, speech: 'Essa consulta já estava cancelada.' };
  return cancelStored(db, found, caller.role, now);
}

/** Pedido por voz: troca a próxima consulta do paciente para um dos horários livres. */
export async function rescheduleNextAppointment(db: Firestore, patientUid: string, startValue: unknown, now = new Date()): Promise<ActionResult> {
  const [current] = await upcomingForPatient(db, patientUid, now);
  if (!current) return { ok: false, status: 409, speech: `${NO_APPOINTMENT} Quer que eu marque uma nova?` };
  const access = await getAccess(db, current.nutritionistId);
  if (!access.ok) {
    return { ok: false, status: access.reason === 'unavailable' ? 502 : 409,
      speech: 'Não consegui acessar a agenda agora, então a consulta continua no horário de antes. Tente de novo em instantes.' };
  }
  const settings = await loadSettings(db, current.nutritionistId);
  const checked = validateSlotStart(settings, String(startValue || ''), now);
  if ('error' in checked) return { ok: false, status: 422, speech: `${checked.error} Peça para eu buscar os horários livres de novo.` };
  const { start, end } = checked;
  const previous: Interval = { start: new Date(current.startAt), end: new Date(current.endAt) };
  if (start.getTime() === previous.start.getTime()) return { ok: false, status: 409, speech: `Sua consulta já está marcada para ${current.label}.` };
  const tz = settings.timezone;

  let busy: Interval[];
  try { busy = await busyIntervals(access.token, { start: new Date(start.getTime() - 3_600_000), end: new Date(end.getTime() + 3_600_000) }, tz); }
  catch { return { ok: false, status: 502, speech: 'Não consegui ver a agenda agora. Tente de novo em instantes.' }; }
  // O horário de antes não conta como ocupado: é a própria consulta que está mudando de lugar.
  if (!isFree(start, end, withoutInterval(busy, previous), settings.intervalMinutes)) {
    return { ok: false, status: 409, speech: 'Esse horário acabou de ser ocupado. Quer que eu veja outros horários livres?' };
  }

  const res = await googleRequest(access.token, 'PATCH', `${eventUrl(current)}?${notifyGuests(current)}`, {
    start: { dateTime: toOffsetIso(start, tz), timeZone: tz },
    end: { dateTime: toOffsetIso(end, tz), timeZone: tz },
  }).catch(() => null);
  if (res && (res.status === 404 || res.status === 410)) {
    await markCancelled(db, current, now);
    return { ok: false, status: 409, speech: 'Essa consulta não está mais na agenda da nutricionista. Quer que eu marque uma nova?' };
  }
  if (!res || !res.ok) {
    return { ok: false, status: 502, speech: 'Não consegui remarcar na agenda agora. A consulta continua no horário de antes. Tente de novo em instantes.' };
  }
  const updated = await applyNewTime(db, current, start, end, tz, now);

  const nutriName = settings.displayName || 'sua nutricionista';
  let patientMailed = false;
  if (updated.patientEmail) {
    try {
      await sendMail(access.token, {
        fromName: settings.displayName || 'NutriAli', fromEmail: access.email, to: updated.patientEmail,
        subject: `Consulta remarcada: ${updated.label}`,
        html: emailLayout('Sua consulta foi remarcada', [
          p(`Olá, ${escapeHtml(updated.patientName)}!`),
          p(`Sua consulta com ${escapeHtml(nutriName)} agora é <strong>${escapeHtml(updated.label)}</strong>. O horário de antes era ${escapeHtml(current.label)}.`),
          p(whereLine(updated, settings)),
          p('Se precisar mudar de novo, é só pedir para a Ali no aplicativo.'),
        ].join(''), 'Consulta remarcada pela Ali, a assistente do NutriAli.'),
      });
      patientMailed = true;
    } catch {
      console.error('Ali: falha ao enviar a remarcação ao paciente.');
    }
  }
  try {
    await sendMail(access.token, {
      fromName: 'Ali — NutriAli', fromEmail: access.email, to: access.email,
      subject: `Consulta remarcada pelo paciente: ${updated.patientName} — ${updated.label}`,
      html: emailLayout('Consulta remarcada pelo paciente', [
        p(`<strong>Paciente:</strong> ${escapeHtml(updated.patientName)}`),
        p(`<strong>Novo horário:</strong> ${escapeHtml(updated.label)}`),
        p(`<strong>Horário de antes:</strong> ${escapeHtml(current.label)}`),
      ].join(''), 'Aviso automático do NutriAli.'),
    });
  } catch {
    console.error('Ali: falha ao avisar a remarcação.');
  }

  return {
    ok: true,
    speech: `Pronto! Remarquei a sua consulta para ${updated.label}. `
      + (patientMailed ? 'Mandei a confirmação para o seu e-mail.' : 'O convite atualizado chega pela agenda do Google.'),
    appointment: { label: updated.label, start: updated.startLocal, mode: updated.mode },
  };
}

function reminderMail(a: AppointmentRecord, kind: ReminderKind, settings: AliSettings, fromEmail: string) {
  const nutriName = settings.displayName || 'sua nutricionista';
  return {
    fromName: settings.displayName || 'NutriAli', fromEmail, to: a.patientEmail as string,
    subject: kind === 'day' ? `Lembrete da sua consulta: ${a.label}` : `Sua consulta começa às ${a.startLocal.slice(11, 16)}`,
    html: emailLayout(kind === 'day' ? 'Lembrete da sua consulta' : 'Sua consulta começa em breve', [
      p(`Olá, ${escapeHtml(a.patientName)}!`),
      p(`Sua consulta com ${escapeHtml(nutriName)} é <strong>${escapeHtml(a.label)}</strong>.`),
      p(whereLine(a, settings)),
      p('Se precisar remarcar ou cancelar, é só pedir para a Ali no aplicativo.'),
    ].join(''), 'Lembrete automático do NutriAli.'),
  };
}

export interface ReminderStats { checked: number; sent: number; cancelled: number; moved: number; failed: number }

/**
 * Chamado a cada poucos minutos pelo n8n: manda os lembretes que estão na hora.
 * Antes de lembrar, confere a consulta na agenda do Google, porque a nutricionista
 * pode ter apagado ou mudado o evento por lá. O retorno só tem contagens, sem dados de pacientes.
 */
export async function runAppointmentReminders(db: Firestore, now = new Date()): Promise<ReminderStats> {
  const stats: ReminderStats = { checked: 0, sent: 0, cancelled: 0, moved: 0, failed: 0 };
  const snap = await db.collection(APPOINTMENTS_COLLECTION)
    .where('startAt', '>=', now.toISOString())
    .where('startAt', '<=', new Date(now.getTime() + 25 * 3_600_000).toISOString())
    .get();
  const settingsCache = new Map<string, AliSettings>();
  const settingsFor = async (nutritionistId: string) => {
    const cached = settingsCache.get(nutritionistId);
    if (cached) return cached;
    const loaded = await loadSettings(db, nutritionistId);
    settingsCache.set(nutritionistId, loaded);
    return loaded;
  };

  for (const doc of snap.docs) {
    const a: StoredAppointment = { ...(doc.data() as AppointmentRecord), ref: doc.ref };
    if (a.status !== 'scheduled') continue;
    stats.checked++;
    try {
      const start = new Date(a.startAt);
      const due = dueReminders(start, now, a.reminders || { day: 'skipped', hour: 'skipped' });
      const changes: Record<string, unknown> = {};
      for (const kind of due.skip) changes[`reminders.${kind}`] = 'skipped';

      if (due.send.length) {
        const access = await getAccess(db, a.nutritionistId);
        const event = access.ok ? await googleRequest(access.token, 'GET', eventUrl(a)).catch(() => null) : null;
        if (event && (event.status === 404 || event.status === 410 || event.json.status === 'cancelled')) {
          await markCancelled(db, a, now);
          stats.cancelled++;
          continue;
        }
        if (!access.ok || !event || !event.ok) {
          stats.failed++;
        } else {
          const eventStart = Date.parse(String(event.json.start?.dateTime || ''));
          const eventEnd = Date.parse(String(event.json.end?.dateTime || ''));
          if (Number.isFinite(eventStart) && Number.isFinite(eventEnd) && eventStart !== start.getTime()) {
            await applyNewTime(db, a, new Date(eventStart), new Date(eventEnd), (await settingsFor(a.nutritionistId)).timezone, now);
            stats.moved++;
            continue;
          }
          for (const kind of due.send) {
            if (!a.patientEmail) { changes[`reminders.${kind}`] = 'skipped'; continue; }
            try {
              await sendMail(access.token, reminderMail(a, kind, await settingsFor(a.nutritionistId), access.email));
              changes[`reminders.${kind}`] = 'sent';
              stats.sent++;
            } catch {
              stats.failed++;
            }
          }
        }
      }
      if (Object.keys(changes).length) await a.ref.update({ ...changes, updatedAt: now.toISOString() });
    } catch {
      stats.failed++;
    }
  }
  return stats;
}
