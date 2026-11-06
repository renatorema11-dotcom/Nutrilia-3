// Dados que o próprio paciente informa (triagem inicial e tela de configurações), gravados no prontuário pelo servidor.
// O navegador não altera idade, peso ou medidas direto no banco: tudo passa por aqui, com conferência.
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { dailyKey } from './daily-log';

export interface CleanProfile { name: string; age: number; height: number; weight: number; objective: string; targetWeight?: number; initialWeight?: number }

type ProfileCheck = { ok: true; profile: CleanProfile } | { ok: false; error: string };
type StoredMeasurement = { date: string; weight: number; height?: number; bodyFat?: number; source?: string };

/** Número digitado pelo paciente: aceita vírgula e texto ("72,5"). */
function profileNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return Number(value.trim().replace(',', '.'));
  return NaN;
}

/** Confere os dados informados pelo paciente. As faixas são as mesmas mostradas nas telas. */
export function validateProfile(input: unknown): ProfileCheck {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Dados inválidos.' };
  const body = input as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
  if (!name) return { ok: false, error: 'Informe o seu nome.' };
  const age = Math.round(profileNumber(body.age));
  if (!(age >= 1 && age <= 120)) return { ok: false, error: 'A idade deve estar entre 1 e 120 anos.' };
  const height = Math.round(profileNumber(body.height));
  if (!(height >= 50 && height <= 300)) return { ok: false, error: 'A altura deve estar entre 50 e 300 cm.' };
  const weight = Math.round(profileNumber(body.weight) * 10) / 10;
  if (!(weight >= 10 && weight <= 500)) return { ok: false, error: 'O peso deve estar entre 10 e 500 kg.' };
  const objective = typeof body.objective === 'string' ? body.objective.trim().slice(0, 80) : '';
  if (!objective) return { ok: false, error: 'Escolha o seu objetivo.' };
  const profile: CleanProfile = { name, age, height, weight, objective };
  // Meta e peso inicial são opcionais: em branco, o que já está no prontuário continua valendo.
  for (const [field, label] of [['targetWeight', 'A meta de peso'], ['initialWeight', 'O peso inicial']] as const) {
    const raw = body[field];
    if (raw === undefined || raw === null || raw === '') continue;
    const kilos = Math.round(profileNumber(raw) * 10) / 10;
    if (!(kilos >= 10 && kilos <= 500)) return { ok: false, error: `${label} deve estar entre 10 e 500 kg.` };
    profile[field] = kilos;
  }
  return { ok: true, profile };
}

/**
 * Versões antigas do app criavam o prontuário de quem se cadastrava sozinho com valores inventados
 * (30 anos, 70 kg, 168 cm). Esses registros são reconhecidos para serem trocados pelos dados reais.
 */
export function isInventedRecord(record: Record<string, unknown> | null): boolean {
  if (!record) return false;
  const list = Array.isArray(record.measurements) ? record.measurements : [];
  return record.age === 30 && record.weight === 70 && record.height === 168 && record.initialWeight === undefined
    && list.length <= 1 && list.every((m) => m && m.weight === 70 && m.height === 168);
}

/** Monta o que muda no prontuário. Cada peso informado vira uma medição do dia, marcada como vinda do paciente. */
export function profilePatch(existing: Record<string, unknown> | null, uid: string, email: string, profile: CleanProfile, now: Date): Record<string, unknown> {
  const invented = isInventedRecord(existing);
  const today = dailyKey(now);
  const stored = !invented && existing && Array.isArray(existing.measurements) ? existing.measurements : [];
  const measurements: StoredMeasurement[] = stored.filter((m): m is StoredMeasurement => !!m && typeof m === 'object' && typeof m.weight === 'number');
  const last = measurements[measurements.length - 1];
  const entry: StoredMeasurement = { date: today, weight: profile.weight, height: profile.height, source: 'patient' };
  if (last && last.date === today && last.source === 'patient') measurements[measurements.length - 1] = { ...last, ...entry };
  else if (!last || last.weight !== profile.weight || (last.height ?? profile.height) !== profile.height) measurements.push(entry);

  const keepInitial = !invented && existing && typeof existing.initialWeight === 'number';
  const patch: Record<string, unknown> = {
    name: profile.name, age: profile.age, height: profile.height, weight: profile.weight, objective: profile.objective,
    initialWeight: profile.initialWeight ?? (keepInitial ? existing.initialWeight : (measurements[0]?.weight ?? profile.weight)),
    measurements,
  };
  if (profile.targetWeight !== undefined) patch.targetWeight = profile.targetWeight;
  if (!existing) Object.assign(patch, { id: uid, email, createdAt: now.toISOString(), currentPlan: null, pastPlans: [] });
  return patch;
}

/** Marca o cadastro como conferido e apaga as cópias antigas guardadas fora do prontuário (inclusive o histórico de exemplo). */
function cleanUserDoc(db: Firestore, uid: string, extra: Record<string, unknown> = {}) {
  return db.collection('users').doc(uid).set(
    { ...extra, profileSynced: true, patientData: FieldValue.delete(), patientHistory: FieldValue.delete() },
    { merge: true },
  );
}

/** Triagem inicial e tela de configurações: grava no prontuário o que o paciente informou. */
export async function saveProfile(db: Firestore, uid: string, input: unknown, now = new Date()): Promise<ProfileCheck> {
  const checked = validateProfile(input);
  if (!checked.ok) return checked;
  const ref = db.collection('patients').doc(uid);
  const [snap, userSnap] = await Promise.all([ref.get(), db.collection('users').doc(uid).get()]);
  const email = String(userSnap.exists ? userSnap.data()?.email || '' : '');
  await ref.set(profilePatch(snap.exists ? snap.data() || {} : null, uid, email, checked.profile, now), { merge: true });
  await cleanUserDoc(db, uid, { displayName: checked.profile.name });
  return checked;
}

/**
 * Conserto único para contas antigas: se a triagem do paciente ficou guardada fora do prontuário e o prontuário
 * ainda tem os valores inventados (ou nem existe), os dados reais passam a valer. Devolve se algo mudou.
 */
export async function syncLegacyProfile(db: Firestore, uid: string, now = new Date()): Promise<{ changed: boolean }> {
  const userSnap = await db.collection('users').doc(uid).get();
  const user = userSnap.exists ? userSnap.data() || {} : {};
  if (user.profileSynced === true) return { changed: false };
  const email = String(user.email || '');
  const ref = db.collection('patients').doc(uid);
  const snap = await ref.get();
  const existing = snap.exists ? snap.data() || {} : null;
  const legacy = user.patientData && typeof user.patientData === 'object' ? user.patientData as Record<string, unknown> : null;
  const checked = legacy
    ? validateProfile({ ...legacy, name: legacy.name || existing?.name || user.displayName })
    : { ok: false as const, error: '' };
  let changed = false;
  if (checked.ok && (!existing || isInventedRecord(existing))) {
    await ref.set(profilePatch(existing, uid, email, checked.profile, now), { merge: true });
    changed = true;
  } else if (isInventedRecord(existing)) {
    // Sem triagem guardada, os valores inventados saem do prontuário: o app pede a triagem de verdade.
    await ref.set({
      age: FieldValue.delete(), weight: FieldValue.delete(), height: FieldValue.delete(), objective: FieldValue.delete(), measurements: [],
    }, { merge: true });
    changed = true;
  }
  await cleanUserDoc(db, uid);
  return { changed };
}
