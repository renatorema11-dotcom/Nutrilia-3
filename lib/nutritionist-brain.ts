// Segundo cérebro da Ali da nutricionista: as contas com os dados do prontuário, a conferência do plano e a busca
// nos registros dela. Somente no servidor. Cada função recebe o uid já conferido pela rota e o paciente já encontrado
// na lista dela (lib/nutritionist-actions.ts); mesmo assim o prontuário é conferido de novo antes de ser usado.
import type { Firestore } from 'firebase-admin/firestore';
import type { ActionResult } from './google-workspace';
import { cleanText, joinPt, normalizeName } from './ali-settings';
import { CLINICAL_COLLECTION, CLINICAL_LISTS, clinicalAvoidTerms, clinicalContextForPlan, loadClinicalProfile } from './clinical-profile';
import { MEMORY_COLLECTION, memoryForPrompt } from './ali-memory';
import { NOTES_COLLECTION } from './consultation-notes';
import { bodyMetrics, energyNeeds, macroSplit, planCheck } from './nutrition-calc';

type BrainPatient = { uid: string; name: string };
type BrainData = Record<string, unknown>;

interface BrainRecord { data: BrainData; weight: number | null; height: number | null; age: number | null }

const brainPositive = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);
const brainEmpty = (value: unknown) => value === undefined || value === null || (typeof value === 'string' && !value.trim());
const brainNumber = (value: number) => String(Math.round(value * 10) / 10).replace('.', ',');

/** O prontuário do paciente, só se ele for dessa nutricionista. A medição mais recente vale mais que o cadastro. */
async function brainRecord(db: Firestore, nutritionistId: string, patientUid: string): Promise<BrainRecord | null> {
  const snap = await db.collection('patients').doc(patientUid).get();
  const data: BrainData | null = snap.exists ? snap.data() || {} : null;
  if (!data || data.nutritionistId !== nutritionistId) return null;
  const measures = (Array.isArray(data.measurements) ? data.measurements : [])
    .filter((m: BrainData) => m && typeof m === 'object' && typeof m.date === 'string')
    .sort((a: BrainData, b: BrainData) => String(a.date).localeCompare(String(b.date)));
  const latest = (key: string): number | null => {
    for (let i = measures.length - 1; i >= 0; i--) {
      const value = brainPositive(measures[i][key]);
      if (value !== null) return value;
    }
    return null;
  };
  return { data, weight: latest('weight') ?? brainPositive(data.weight), height: latest('height') ?? brainPositive(data.height), age: brainPositive(data.age) };
}

const brainNoRecord = (patient: BrainPatient): ActionResult => ({ ok: false, status: 404, speech: `Não encontrei o prontuário de ${patient.name}.` });

/**
 * Completa o que ela não disse com o que está no prontuário e conta o que foi usado, para a Ali falar de onde vieram
 * os números (a nutricionista precisa saber com que dados a conta foi feita).
 */
function brainFill(input: BrainData, known: { key: string; value: unknown; label: (value: never) => string }[]): { values: BrainData; used: string[] } {
  const values: BrainData = { ...input };
  const used: string[] = [];
  for (const item of known) {
    if (!brainEmpty(values[item.key]) || brainEmpty(item.value)) continue;
    values[item.key] = item.value;
    used.push(item.label(item.value as never));
  }
  return { values, used };
}

const BRAIN_ACTIVITY: Record<string, string> = { sedentario: 'sedentário', leve: 'leve', moderado: 'moderado', intenso: 'intenso', muito_intenso: 'muito intenso' };

const brainLabels = {
  weight: (value: number) => `peso de ${brainNumber(value)} quilos`,
  height: (value: number) => `altura de ${brainNumber(value)} centímetros`,
  age: (value: number) => `${Math.round(value)} anos`,
  sex: (value: string) => `sexo ${value === 'F' ? 'feminino' : 'masculino'}`,
  activity: (value: string) => `nível de atividade ${BRAIN_ACTIVITY[value] || value}`,
};

function brainWithSource(result: ActionResult, patient: BrainPatient, used: string[]): ActionResult {
  if (!result.ok) return result;
  const source = used.length ? `Usei do prontuário de ${patient.name}: ${joinPt(used)}. ` : '';
  return { ...result, speech: `${source}${result.speech}`, patientName: patient.name, fromRecord: used };
}

/** Gasto de energia (repouso e total). Sem paciente, usa só o que ela disser; com paciente, completa pelo prontuário e pela ficha. */
export async function energyNeedsFor(db: Firestore, nutritionistId: string, patient: BrainPatient | null, input: BrainData): Promise<ActionResult> {
  if (!patient) return energyNeeds(input);
  const record = await brainRecord(db, nutritionistId, patient.uid);
  if (!record) return brainNoRecord(patient);
  const profile = await loadClinicalProfile(db, nutritionistId, patient.uid);
  const filled = brainFill(input, [
    { key: 'weight', value: record.weight, label: brainLabels.weight },
    { key: 'height', value: record.height, label: brainLabels.height },
    { key: 'age', value: record.age, label: brainLabels.age },
    { key: 'sex', value: profile.sex, label: brainLabels.sex },
    { key: 'activity', value: profile.activity, label: brainLabels.activity },
  ]);
  return brainWithSource(energyNeeds(filled.values), patient, filled.used);
}

/** IMC e faixa de peso para a altura, com os dados do prontuário quando ela não disser os números. */
export async function bodyMetricsFor(db: Firestore, nutritionistId: string, patient: BrainPatient | null, input: BrainData): Promise<ActionResult> {
  if (!patient) return bodyMetrics(input);
  const record = await brainRecord(db, nutritionistId, patient.uid);
  if (!record) return brainNoRecord(patient);
  const filled = brainFill(input, [
    { key: 'weight', value: record.weight, label: brainLabels.weight },
    { key: 'height', value: record.height, label: brainLabels.height },
    { key: 'age', value: record.age, label: brainLabels.age },
  ]);
  return brainWithSource(bodyMetrics(filled.values), patient, filled.used);
}

/** Divisão das calorias em proteína, carboidrato e gordura; o peso do prontuário entra na proteína por quilo. */
export async function macrosFor(db: Firestore, nutritionistId: string, patient: BrainPatient | null, input: BrainData): Promise<ActionResult> {
  if (!patient) return macroSplit(input);
  const record = await brainRecord(db, nutritionistId, patient.uid);
  if (!record) return brainNoRecord(patient);
  const filled = brainFill(input, [{ key: 'weight', value: record.weight, label: brainLabels.weight }]);
  return brainWithSource(macroSplit(filled.values), patient, filled.used);
}

const brainPlan = (value: unknown): BrainData | null => (value && typeof value === 'object' && !Array.isArray(value) ? value as BrainData : null);

/**
 * Confere o plano de um paciente: calorias e macros por dia (TACO), proteína por quilo, diferença para a meta que ela
 * disser e itens que batem com alergias, intolerâncias, restrições e aversões da ficha. Por padrão olha o rascunho
 * que espera aprovação; sem rascunho, o plano aprovado. É apoio: quem decide e aprova é ela, no app.
 */
export async function checkPlanFor(db: Firestore, nutritionistId: string, patient: BrainPatient, input: { which?: unknown; targetKcal?: unknown }): Promise<ActionResult> {
  const record = await brainRecord(db, nutritionistId, patient.uid);
  if (!record) return brainNoRecord(patient);
  const pending = brainPlan(record.data.pendingPlan);
  const current = brainPlan(record.data.currentPlan);
  const draft = pending || (current && current.status !== 'approved' ? current : null);
  const approved = current && current.status === 'approved' ? current : null;
  const asked = normalizeName(cleanText(input.which, 30));
  const wantsApproved = ['approved', 'aprovado', 'atual', 'plano aprovado', 'plano atual'].includes(asked);
  const wantsDraft = ['draft', 'rascunho'].includes(asked);
  if (wantsApproved && !approved) return { ok: false, status: 404, speech: `${patient.name} ainda não tem plano aprovado.` };
  if (wantsDraft && !draft) return { ok: false, status: 404, speech: `${patient.name} não tem rascunho de plano esperando aprovação.` };
  const plan = wantsApproved ? approved : wantsDraft ? draft : draft || approved;
  if (!plan) return { ok: false, status: 404, speech: `${patient.name} ainda não tem plano alimentar nem rascunho para eu conferir.` };

  const rawTarget = typeof input.targetKcal === 'string' ? Number(input.targetKcal.trim().replace(',', '.')) : input.targetKcal;
  const targetKcal = typeof rawTarget === 'number' && Number.isFinite(rawTarget) && rawTarget >= 800 && rawTarget <= 6000 ? Math.round(rawTarget) : null;
  if (!brainEmpty(input.targetKcal) && targetKcal === null) return { ok: false, status: 422, speech: 'Diga a meta de calorias por dia, entre 800 e 6000.' };
  const profile = await loadClinicalProfile(db, nutritionistId, patient.uid);
  return planCheck(plan, { patientName: patient.name, label: plan === approved ? 'plano aprovado' : 'rascunho', weight: record.weight, targetKcal, avoid: clinicalAvoidTerms(profile) });
}

/**
 * O que o rascunho de plano feito pela IA leva do segundo cérebro: a ficha clínica do paciente (sem o nome) e as
 * preferências de trabalho da nutricionista. Vale para o rascunho pedido à Ali e para o botão do prontuário.
 */
export async function planBrainContext(db: Firestore, nutritionistId: string, patientUid: string): Promise<Record<string, unknown>> {
  const [profile, preferences, record] = await Promise.all([
    loadClinicalProfile(db, nutritionistId, patientUid),
    memoryForPrompt(db, nutritionistId),
    db.collection('patients').doc(patientUid).get(),
  ]);
  const data = record.exists ? record.data() || {} : {};
  const name = data.nutritionistId === nutritionistId && typeof data.name === 'string' ? data.name : '';
  const ficha = clinicalContextForPlan(profile);
  // Observações e preferências são texto livre: se o nome do paciente aparecer nelas, ele não vai para a IA.
  const redacted = brainRedact({ ...(ficha ? { fichaClinica: ficha } : {}), ...(preferences ? { preferenciasDaNutricionista: preferences } : {}) }, name);
  return redacted && typeof redacted === 'object' ? redacted as Record<string, unknown> : {};
}

const BRAIN_NAME_SKIP = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
const BRAIN_WORD = /[A-Za-zÀ-ÖØ-öø-ÿ0-9]+/g;

/** Troca cada parte do nome do paciente (sem acento e sem maiúscula contam como iguais) por "o paciente", em todo texto. */
function brainRedact(value: unknown, name: string): unknown {
  const parts = new Set(normalizeName(name).split(' ').filter((word) => word.length >= 3 && !BRAIN_NAME_SKIP.has(word)));
  if (!parts.size) return value;
  const fix = (text: string) => text
    .replace(BRAIN_WORD, (word) => (parts.has(normalizeName(word)) ? '\u0000' : word))
    .replace(/\u0000(?:\s+\u0000)*/g, 'o paciente');
  const walk = (item: unknown): unknown => {
    if (typeof item === 'string') return fix(item);
    if (Array.isArray(item)) return item.map(walk);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, inner]) => [key, walk(inner)]));
    return item;
  };
  return walk(value);
}

// ───────────── Busca nos registros dela ─────────────

const BRAIN_SEARCH_STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os', 'e', 'em', 'no', 'na', 'nos', 'nas', 'com', 'para', 'por', 'que', 'um', 'uma',
  'quem', 'qual', 'quais', 'tem', 'paciente', 'pacientes', 'sobre', 'meu', 'minha', 'meus', 'minhas']);
const BRAIN_SEARCH_SPOKEN = 5;
const BRAIN_SEARCH_MAX = 20;

export interface BrainHit { kind: 'ficha' | 'anotacao' | 'pendencia' | 'paciente' | 'preferencia'; patientName: string | null; date: string | null; text: string }

/** Trecho do texto em volta da primeira palavra achada, para a Ali não ler a anotação inteira. */
function brainSnippet(text: string, words: string[], max = 160): string {
  const tokens = text.replace(/\s+/g, ' ').trim().split(' ');
  const at = tokens.findIndex((token) => { const flat = normalizeName(token); return words.some((word) => flat.startsWith(word)); });
  const from = Math.max(0, at - 8);
  const piece = tokens.slice(from, from + 28).join(' ');
  const clipped = piece.length > max ? `${piece.slice(0, max).replace(/\s+\S*$/, '')}…` : piece;
  return `${from > 0 ? '…' : ''}${clipped}`;
}

const brainDay = (iso: string, timeZone: string) => {
  const at = new Date(iso);
  // "1º de dezembro": com o número sozinho a voz lê "um de dezembro".
  return Number.isNaN(at.getTime()) ? '' : new Intl.DateTimeFormat('pt-BR', { timeZone, day: 'numeric', month: 'long' }).format(at).replace(/^1 de /, '1º de ');
};

/**
 * Procura por assunto nos registros da própria nutricionista: fichas clínicas, anotações de consulta, pendências,
 * pacientes (nome e objetivo) e preferências. Todas as palavras precisam aparecer (vale o começo da palavra, sem acento).
 * É busca por palavras, não por significado: "lactose" acha "intolerância a lactose", mas não acha "leite".
 */
export async function searchRecords(db: Firestore, nutritionistId: string, input: { query?: unknown }, timeZone: string): Promise<ActionResult> {
  const query = cleanText(input.query, 120).replace(/\s+/g, ' ');
  const words = normalizeName(query).split(' ').filter((word) => word.length >= 2 && !BRAIN_SEARCH_STOP.has(word));
  if (!words.length) return { ok: false, status: 422, speech: 'O que você quer procurar nos seus registros? Diga uma ou duas palavras, como lactose ou diabetes.' };
  const matches = (text: unknown) => {
    if (typeof text !== 'string' || !text) return false;
    const flat = ` ${normalizeName(text)}`;
    return words.every((word) => flat.includes(` ${word}`));
  };
  const mine = (col: string) => db.collection(col).where('nutritionistId', '==', nutritionistId).get();
  const [patients, notes, profiles, memory] = await Promise.all([mine('patients'), mine(NOTES_COLLECTION), mine(CLINICAL_COLLECTION), mine(MEMORY_COLLECTION)]);
  // Só pacientes que continuam com ela: registro de quem saiu da lista não aparece.
  const names = new Map<string, string>();
  for (const doc of patients.docs) {
    const name = doc.data()?.name;
    if (typeof name === 'string' && name.trim()) names.set(doc.id, name.trim());
  }

  const hits: BrainHit[] = [];
  for (const doc of profiles.docs) {
    const d = doc.data() || {};
    const patientName = typeof d.patientUid === 'string' ? names.get(d.patientUid) : undefined;
    if (!patientName) continue;
    for (const list of CLINICAL_LISTS) {
      for (const item of Array.isArray(d[list.key]) ? d[list.key] : []) {
        if (matches(item) || matches(`${list.label} ${item}`)) hits.push({ kind: 'ficha', patientName, date: null, text: `${list.label}: ${item}` });
      }
    }
    if (matches(d.notes)) hits.push({ kind: 'ficha', patientName, date: null, text: `observações: ${brainSnippet(d.notes, words)}` });
  }
  const noteHits: BrainHit[] = [];
  for (const doc of notes.docs) {
    const d = doc.data() || {};
    const patientName = typeof d.patientUid === 'string' ? names.get(d.patientUid) : undefined;
    if (patientName && matches(d.text)) noteHits.push({ kind: 'anotacao', patientName, date: typeof d.createdAt === 'string' ? d.createdAt : null, text: brainSnippet(d.text, words) });
  }
  hits.push(...noteHits.sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))));
  for (const doc of memory.docs) {
    const d = doc.data() || {};
    if (d.kind !== 'followup' || d.status === 'done') continue;
    // Pendência ligada a um paciente que saiu da lista dela fica de fora, como as fichas e anotações dele.
    if (typeof d.patientUid === 'string' && d.patientUid && !names.has(d.patientUid)) continue;
    const patientName = typeof d.patientUid === 'string' ? names.get(d.patientUid) || null : null;
    if (matches(d.text) || (patientName && matches(`${patientName} ${d.text}`))) hits.push({ kind: 'pendencia', patientName, date: typeof d.dueDate === 'string' ? d.dueDate : null, text: String(d.text) });
  }
  for (const doc of patients.docs) {
    const d = doc.data() || {};
    const name = names.get(doc.id);
    if (name && (matches(name) || matches(d.objective))) hits.push({ kind: 'paciente', patientName: name, date: null, text: typeof d.objective === 'string' && d.objective.trim() ? `objetivo: ${d.objective.trim()}` : 'paciente da sua lista' });
  }
  for (const doc of memory.docs) {
    const d = doc.data() || {};
    if (d.kind === 'preference' && matches(d.text)) hits.push({ kind: 'preferencia', patientName: null, date: null, text: String(d.text) });
  }

  if (!hits.length) return { ok: true, speech: `Não achei nada com ${query} nas suas fichas, anotações, pendências e pacientes. A busca é por palavra: tente outro termo.`, results: [], total: 0 };
  const say = (hit: BrainHit) => {
    const text = /[.!?…]$/.test(hit.text) ? hit.text : `${hit.text}.`;
    if (hit.kind === 'ficha') return `Na ficha de ${hit.patientName}, ${text}`;
    if (hit.kind === 'anotacao') return `Em anotação de ${hit.patientName}${hit.date ? `, de ${brainDay(hit.date, timeZone)}` : ''}: ${text}`;
    if (hit.kind === 'pendencia') return `Pendência${hit.patientName ? ` de ${hit.patientName}` : ''}: ${text}`;
    if (hit.kind === 'paciente') return `${hit.patientName}, ${text}`;
    return `Preferência sua: ${text}`;
  };
  const people = new Set(hits.map((hit) => hit.patientName).filter(Boolean)).size;
  const rest = hits.length - BRAIN_SEARCH_SPOKEN;
  return {
    ok: true,
    speech: `Achei ${hits.length} ${hits.length === 1 ? 'registro' : 'registros'} com ${query}${people > 1 ? `, em ${people} pacientes` : ''}. `
      + hits.slice(0, BRAIN_SEARCH_SPOKEN).map(say).join(' ') + (rest > 0 ? ` E mais ${rest}.` : ''),
    results: hits.slice(0, BRAIN_SEARCH_MAX),
    total: hits.length,
  };
}
