// Consultas marcadas à mão no app (sem a Ali e sem a agenda do Google). Somente no servidor.
// A consulta entra na lista da nutricionista e na do paciente, para as duas pontas enxergarem a mesma coisa.
import { randomBytes } from 'node:crypto';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';

export const MANUAL_PREFIX = 'man_';

export interface ManualAppointment {
  id: string;
  patientName: string;
  date: string;
  time: string;
  type: 'Primeira' | 'Retorno';
  status: 'Agendada' | 'Cancelada';
  source: 'manual';
  /** Quem marcou: mostra "marcada pelo paciente" para a nutricionista. */
  createdBy: 'patient' | 'nutritionist';
  patientUid?: string;
  nutritionistId?: string;
}

type ManualResult = { ok: true; appointment: ManualAppointment; shared: boolean } | { ok: false; status: number; error: string };
type ManualCaller = { uid: string; role: 'patient' | 'nutritionist' };

const manualText = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** Data (AAAA-MM-DD) e hora (HH:MM) válidas e ainda não passadas, no horário de Brasília. */
export function manualStart(date: unknown, time: unknown, now: Date): Date | null {
  if (typeof date !== 'string' || typeof time !== 'string') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  // Recusa datas que não existem (31 de fevereiro), que o JavaScript empurraria para o mês seguinte.
  const [year, month, day] = date.split('-').map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  const start = new Date(`${date}T${time}:00-03:00`);
  return start.getTime() > now.getTime() ? start : null;
}

async function addToList(db: Firestore, uid: string, entry: ManualAppointment) {
  await db.collection('users').doc(uid).set({ appointments: FieldValue.arrayUnion(entry) }, { merge: true });
}

/** Marca a consulta e grava nas duas listas. A nutricionista só marca para paciente dela; o paciente, com a nutricionista dele. */
export async function createManualAppointment(db: Firestore, caller: ManualCaller, input: unknown, now = new Date()): Promise<ManualResult> {
  const body = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  if (!manualStart(body.date, body.time, now)) return { ok: false, status: 422, error: 'Escolha uma data e um horário que ainda não passaram.' };
  const entry: ManualAppointment = {
    id: MANUAL_PREFIX + randomBytes(9).toString('hex'),
    patientName: '', date: body.date as string, time: body.time as string,
    type: body.type === 'Primeira' ? 'Primeira' : 'Retorno',
    status: 'Agendada', source: 'manual', createdBy: caller.role,
  };

  if (caller.role === 'nutritionist') {
    entry.nutritionistId = caller.uid;
    const patientId = manualText(body.patientId, 200);
    if (patientId) {
      const snap = await db.collection('patients').doc(patientId).get();
      const patient = snap.exists ? snap.data() || {} : null;
      if (!patient || patient.nutritionistId !== caller.uid) return { ok: false, status: 404, error: 'Paciente não encontrado na sua lista.' };
      entry.patientName = manualText(patient.name, 120) || 'Paciente';
      // Só entra na lista do paciente se ele tiver conta no app.
      if ((await db.collection('users').doc(patientId).get()).exists) entry.patientUid = patientId;
    } else {
      entry.patientName = manualText(body.patientName, 120);
      if (!entry.patientName) return { ok: false, status: 422, error: 'Escolha o paciente ou informe o nome.' };
    }
  } else {
    const snap = await db.collection('patients').doc(caller.uid).get();
    const patient = snap.exists ? snap.data() || {} : {};
    entry.patientUid = caller.uid;
    entry.patientName = manualText(patient.name, 120) || 'Paciente';
    if (typeof patient.nutritionistId === 'string' && patient.nutritionistId) entry.nutritionistId = patient.nutritionistId;
  }

  const other = caller.role === 'nutritionist' ? entry.patientUid : entry.nutritionistId;
  await addToList(db, caller.uid, entry);
  if (other) await addToList(db, other, entry);
  return { ok: true, appointment: entry, shared: !!other };
}

async function markCancelledInList(db: Firestore, uid: string, id: string): Promise<ManualAppointment | null> {
  const ref = db.collection('users').doc(uid);
  const snap = await ref.get();
  const list = snap.exists ? snap.data()?.appointments : null;
  const found = Array.isArray(list) ? list.find((a) => a?.id === id && a?.source === 'manual') : null;
  if (!found) return null;
  await ref.set({ appointments: list.map((a: ManualAppointment) => (a?.id === id ? { ...a, status: 'Cancelada' } : a)) }, { merge: true });
  return found as ManualAppointment;
}

/** Cancela a consulta manual nas duas listas. Só quem tem a consulta na própria lista consegue cancelar. */
export async function cancelManualAppointment(db: Firestore, caller: ManualCaller, id: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const mine = await markCancelledInList(db, caller.uid, id);
  if (!mine) return { ok: false, status: 404, error: 'Consulta não encontrada.' };
  const other = caller.role === 'nutritionist' ? mine.patientUid : mine.nutritionistId;
  if (other && other !== caller.uid) await markCancelledInList(db, other, id);
  return { ok: true };
}
