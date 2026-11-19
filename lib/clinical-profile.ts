// Ficha clínica do paciente, mantida pela nutricionista: alergias, intolerâncias, restrições, aversões, preferências,
// condições de saúde, medicamentos, suplementos, sexo, nível de atividade e observações. Somente no servidor.
// É dado de saúde (dado sensível pela LGPD): fica na coleção clinicalProfiles, fechada ao navegador pelas regras.
// Cada ficha é de uma nutricionista (id = nutricionista_paciente) e os dois campos são conferidos ao ler e ao gravar.
// A ficha só apoia (alertas, rascunho e conferência do plano): quem decide a conduta é sempre a nutricionista.
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { cleanText, joinPt, normalizeName } from './ali-settings';
import type { ActionResult } from './google-workspace';

export const CLINICAL_COLLECTION = 'clinicalProfiles';

export type ActivityLevel = 'sedentario' | 'leve' | 'moderado' | 'intenso' | 'muito_intenso';
export type ClinicalListKey = 'allergies' | 'intolerances' | 'restrictions' | 'dislikes' | 'preferences' | 'conditions' | 'medications' | 'supplements';
export type ClinicalField = ClinicalListKey | 'sex' | 'activity' | 'notes';

/** As listas da ficha, na ordem em que a Ali lê: o que pode fazer mal ao paciente vem primeiro. */
export const CLINICAL_LISTS: { key: ClinicalListKey; label: string; singular: string }[] = [
  { key: 'allergies', label: 'alergias', singular: 'alergia' },
  { key: 'intolerances', label: 'intolerâncias', singular: 'intolerância' },
  { key: 'restrictions', label: 'restrições alimentares', singular: 'restrição alimentar' },
  { key: 'dislikes', label: 'não gosta de', singular: 'não gosta de' },
  { key: 'preferences', label: 'preferências', singular: 'preferência' },
  { key: 'conditions', label: 'condições de saúde', singular: 'condição de saúde' },
  { key: 'medications', label: 'medicamentos', singular: 'medicamento' },
  { key: 'supplements', label: 'suplementos', singular: 'suplemento' },
];

export const CLINICAL_LIMITS = { item: 80, perList: 20, notes: 1000 };

export interface ClinicalProfile {
  sex: 'F' | 'M' | null;
  activity: ActivityLevel | null;
  allergies: string[];
  intolerances: string[];
  restrictions: string[];
  dislikes: string[];
  preferences: string[];
  conditions: string[];
  medications: string[];
  supplements: string[];
  notes: string;
  updatedAt: string | null;
  updatedBy: 'app' | 'ali' | null;
}

export function emptyClinicalProfile(): ClinicalProfile {
  return {
    sex: null, activity: null, allergies: [], intolerances: [], restrictions: [], dislikes: [], preferences: [],
    conditions: [], medications: [], supplements: [], notes: '', updatedAt: null, updatedBy: null,
  };
}

const CLIN_ACTIVITY_LABELS: Record<ActivityLevel, string> = { sedentario: 'sedentário', leve: 'leve', moderado: 'moderado', intenso: 'intenso', muito_intenso: 'muito intenso' };
// Palavras ditas (já sem acento e em minúsculas, como saem de normalizeName) e o valor guardado.
const CLIN_SEX_WORDS = new Map<string, 'F' | 'M'>([['f', 'F'], ['feminino', 'F'], ['mulher', 'F'], ['m', 'M'], ['masculino', 'M'], ['homem', 'M']]);
const CLIN_ACTIVITY_WORDS = new Map<string, ActivityLevel>([
  ['sedentario', 'sedentario'], ['sedentaria', 'sedentario'], ['leve', 'leve'], ['moderado', 'moderado'], ['moderada', 'moderado'],
  ['intenso', 'intenso'], ['intensa', 'intenso'], ['muito intenso', 'muito_intenso'], ['muito intensa', 'muito_intenso'],
]);
const CLIN_FIELD_ALIASES: [ClinicalField, string[]][] = [
  ['allergies', ['allergies', 'alergia', 'alergias']],
  ['intolerances', ['intolerances', 'intolerancia', 'intolerancias']],
  ['restrictions', ['restrictions', 'restricao', 'restricoes', 'restricao alimentar', 'restricoes alimentares']],
  ['dislikes', ['dislikes', 'nao gosta', 'nao gosta de', 'aversao', 'aversoes', 'aversao alimentar', 'aversoes alimentares']],
  ['preferences', ['preferences', 'preferencia', 'preferencias', 'preferencia alimentar', 'preferencias alimentares']],
  ['conditions', ['conditions', 'condicao', 'condicoes', 'condicao de saude', 'condicoes de saude', 'doenca', 'doencas', 'diagnostico', 'diagnosticos']],
  ['medications', ['medications', 'medicamento', 'medicamentos', 'remedio', 'remedios', 'medicacao', 'medicacoes']],
  ['supplements', ['supplements', 'suplemento', 'suplementos']],
  ['sex', ['sex', 'sexo']],
  ['activity', ['activity', 'atividade', 'atividade fisica', 'nivel de atividade', 'nivel de atividade fisica']],
  ['notes', ['notes', 'observacao', 'observacoes', 'obs']],
];
const CLIN_FIELD_WORDS = new Map<string, ClinicalField>(CLIN_FIELD_ALIASES.flatMap(([field, words]) => words.map((word): [string, ClinicalField] => [word, field])));
const CLIN_FIELDS_SPOKEN = joinPt(['alergias', 'intolerâncias', 'restrições alimentares', 'aversões', 'preferências', 'condições de saúde', 'medicamentos', 'suplementos', 'sexo', 'nível de atividade', 'observações']);
/** Para a Ali dizer "incluí amendoim nas alergias de Ana" e "tirei amendoim das alergias de Ana". */
const CLIN_PLACES: Record<ClinicalListKey, { into: string; from: string }> = {
  allergies: { into: 'nas alergias', from: 'das alergias' },
  intolerances: { into: 'nas intolerâncias', from: 'das intolerâncias' },
  restrictions: { into: 'nas restrições alimentares', from: 'das restrições alimentares' },
  dislikes: { into: 'nas aversões', from: 'das aversões' },
  preferences: { into: 'nas preferências', from: 'das preferências' },
  conditions: { into: 'nas condições de saúde', from: 'das condições de saúde' },
  medications: { into: 'nos medicamentos', from: 'dos medicamentos' },
  supplements: { into: 'nos suplementos', from: 'dos suplementos' },
};
/** Chaves em português para a IA do plano e para o arquivo da LGPD. */
const CLIN_PT_KEYS: Record<ClinicalListKey, string> = {
  allergies: 'alergias', intolerances: 'intolerancias', restrictions: 'restricoes', dislikes: 'naoGosta',
  preferences: 'preferencias', conditions: 'condicoesDeSaude', medications: 'medicamentos', supplements: 'suplementos',
};
const CLIN_SPEECH_MAX = 520;
const CLIN_FILLERS = new Set(['a', 'o', 'as', 'os', 'ao', 'de', 'do', 'da', 'dos', 'das', 'e']);

const clinValidId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('/');
const clinDocId = (nutritionistId: string, patientUid: string) => `${nutritionistId}_${patientUid}`;
const clinIsList = (field: ClinicalField): field is ClinicalListKey => CLINICAL_LISTS.some((list) => list.key === field);
const clinCapital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const clinPeriod = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`);
const clinClip = (text: string, max: number) => { const clean = text.replace(/\s+/g, ' ').trim(); return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean; };
const clinNameOf = (patient: { name?: unknown } | null | undefined) => cleanText(patient?.name, 120).replace(/\s+/g, ' ');
const clinOwner = (name: string) => (name ? `de ${name}` : 'do paciente');
/** Lista falada curta: os primeiros itens e quantos ficaram de fora. */
const clinSpokenItems = (items: string[], max = 5) => (items.length > max ? `${items.slice(0, max).join(', ')} e mais ${items.length - max}` : joinPt(items));
/** Valor dito para sexo, nível de atividade e observações (vale value ou add, o que a IA mandar). */
const clinValueOf = (input: Record<string, unknown>) => {
  const value = input.value !== undefined && input.value !== null && input.value !== '' ? input.value : input.add;
  return Array.isArray(value) ? value[0] : value;
};

/** Item de lista limpo: uma linha só, sem marcador nem pontuação sobrando nas pontas. */
function clinCleanItem(value: unknown): string {
  return cleanText(value, 300).replace(/\s+/g, ' ').replace(/^[-–•*.,;:\s]+|[.,;:\s]+$/g, '').trim();
}

/** "amendoim, camarão e leite" vira três itens. */
function clinSplitItems(text: string): string[] {
  return text.split(/\s*[,;]\s*|\s+e\s+/i).map(clinCleanItem).filter(Boolean).slice(0, 50);
}

/** Lista limpa: itens de 2 a 80 caracteres, sem repetir (sem acento e em minúsculas contam como iguais), no máximo 20. */
function clinCleanList(value: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(value) ? value.slice(0, 200) : []) {
    const item = clinCleanItem(raw);
    const key = normalizeName(item);
    if (item.length < 2 || item.length > CLINICAL_LIMITS.item || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= CLINICAL_LIMITS.perList) break;
  }
  return out;
}

function clinSexOf(value: unknown): 'F' | 'M' | null {
  if (typeof value !== 'string') return null;
  return CLIN_SEX_WORDS.get(normalizeName(value.slice(0, 40)).replace(/^(sexo|e) /, '')) ?? null;
}

function clinActivityOf(value: unknown): ActivityLevel | null {
  if (typeof value !== 'string') return null;
  return CLIN_ACTIVITY_WORDS.get(normalizeName(value.slice(0, 60)).replace(/^(nivel de atividade|nivel|atividade) /, '')) ?? null;
}

function clinFieldOf(value: unknown): ClinicalField | null {
  return CLIN_FIELD_WORDS.get(normalizeName(cleanText(value, 60)).replace(/^(a|as|o|os) /, '')) ?? null;
}

/** Itens que batem com o que foi dito: igual (sem acento) primeiro; senão, todas as palavras ditas aparecem no item. */
function clinMatchItems(items: string[], spoken: string): string[] {
  const query = normalizeName(spoken);
  if (!query) return [];
  const exact = items.filter((item) => normalizeName(item) === query);
  if (exact.length) return exact;
  const all = query.split(' ');
  const words = all.filter((word) => !CLIN_FILLERS.has(word));
  return items.filter((item) => {
    const text = ` ${normalizeName(item)} `;
    return (words.length ? words : all).every((word) => text.includes(` ${word} `));
  });
}

/** Valida tudo o que chega (da tela ou do banco); o que for inválido fica vazio. */
export function sanitizeClinicalProfile(input: unknown): ClinicalProfile {
  const raw = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const profile = emptyClinicalProfile();
  for (const list of CLINICAL_LISTS) profile[list.key] = clinCleanList(raw[list.key]);
  profile.sex = clinSexOf(raw.sex);
  profile.activity = clinActivityOf(raw.activity);
  profile.notes = cleanText(raw.notes, CLINICAL_LIMITS.notes);
  profile.updatedAt = typeof raw.updatedAt === 'string' && raw.updatedAt.length <= 40 && Number.isFinite(Date.parse(raw.updatedAt)) ? raw.updatedAt : null;
  profile.updatedBy = raw.updatedBy === 'app' || raw.updatedBy === 'ali' ? raw.updatedBy : null;
  return profile;
}

/** A ficha do paciente para essa nutricionista; vazia quando não existe ou quando o documento não é dela. */
export async function loadClinicalProfile(db: Firestore, nutritionistId: string, patientUid: string): Promise<ClinicalProfile> {
  if (!clinValidId(nutritionistId) || !clinValidId(patientUid)) return emptyClinicalProfile();
  const snap = await db.collection(CLINICAL_COLLECTION).doc(clinDocId(nutritionistId, patientUid)).get();
  const data = snap.exists ? snap.data() || {} : null;
  if (!data || data.nutritionistId !== nutritionistId || data.patientUid !== patientUid) return emptyClinicalProfile();
  return sanitizeClinicalProfile(data);
}

type ClinOpened = { ok: true; ref: DocumentReference; profile: ClinicalProfile } | { ok: false; status: 404 | 409 };

/** Abre a ficha para gravar: o paciente precisa ser dela, e um documento com esse id que não seja dela não é tocado. */
async function clinOpen(db: Firestore, nutritionistId: string, patientUid: unknown): Promise<ClinOpened> {
  if (!clinValidId(nutritionistId) || !clinValidId(patientUid)) return { ok: false, status: 404 };
  const ref = db.collection(CLINICAL_COLLECTION).doc(clinDocId(nutritionistId, patientUid));
  const [patientSnap, snap] = await Promise.all([db.collection('patients').doc(patientUid).get(), ref.get()]);
  if (!patientSnap.exists || patientSnap.data()?.nutritionistId !== nutritionistId) return { ok: false, status: 404 };
  const raw = snap.exists ? snap.data() || {} : null;
  if (raw && (raw.nutritionistId !== nutritionistId || raw.patientUid !== patientUid)) return { ok: false, status: 409 };
  return { ok: true, ref, profile: raw ? sanitizeClinicalProfile(raw) : emptyClinicalProfile() };
}

/** Gravação da ficha inteira pela tela do paciente. A rota confere o paciente antes; aqui a conferência se repete. */
export async function saveClinicalProfile(db: Firestore, nutritionistId: string, patientUid: string, input: unknown, source: 'app' | 'ali', now = new Date()): Promise<ClinicalProfile> {
  const opened = await clinOpen(db, nutritionistId, patientUid);
  if (!opened.ok) throw new Error(opened.status === 404 ? 'Ficha clínica: paciente não encontrado entre os desta nutricionista.' : 'Ficha clínica: o documento pertence a outra conta; nada foi gravado.');
  const profile: ClinicalProfile = { ...sanitizeClinicalProfile(input), updatedAt: now.toISOString(), updatedBy: source === 'ali' ? 'ali' : 'app' };
  await opened.ref.set({ nutritionistId, patientUid, ...profile });
  return profile;
}

/** Uma lista como a Ali fala: "alergia a amendoim e camarão", "medicamentos: metformina". */
function clinReadList(key: ClinicalListKey, label: string, items: string[]): string {
  const said = clinSpokenItems(items);
  if (key === 'allergies') return `alergia a ${said}`;
  if (key === 'intolerances') return `intolerância a ${said}`;
  if (key === 'dislikes') return `não gosta de ${said}`;
  return `${label}: ${said}`;
}

/** Só as partes preenchidas, na ordem de leitura. */
function clinProfileParts(profile: ClinicalProfile): string[] {
  const parts = CLINICAL_LISTS.filter((list) => profile[list.key].length).map((list) => clinReadList(list.key, list.label, profile[list.key]));
  if (profile.sex) parts.push(`sexo ${profile.sex === 'F' ? 'feminino' : 'masculino'}`);
  if (profile.activity) parts.push(`nível de atividade ${CLIN_ACTIVITY_LABELS[profile.activity]}`);
  if (profile.notes) parts.push(`observações: ${clinClip(profile.notes, 200)}`);
  return parts;
}

/** A ficha lida em voz alta. Vazia, a Ali explica como preencher. */
export async function getClinicalProfile(db: Firestore, nutritionistId: string, patient: { uid: string; name: string }): Promise<ActionResult> {
  if (!patient || !clinValidId(patient.uid)) return { ok: false, status: 404, speech: 'Não encontrei esse paciente. Pode repetir o nome?' };
  const profile = await loadClinicalProfile(db, nutritionistId, patient.uid);
  const name = clinNameOf(patient);
  const parts = clinProfileParts(profile);
  if (!parts.length) {
    const example = name ? name.split(' ')[0] : 'o paciente';
    return { ok: true, speech: `A ficha clínica ${clinOwner(name)} ainda está vazia. É só me dizer, por exemplo: anote que ${example} tem alergia a amendoim.`, profile };
  }
  // "Ficha de Ana: alergia a amendoim." Quando a primeira parte já tem dois-pontos, a frase de abertura fecha antes.
  let speech = clinPeriod(parts[0].includes(':') ? `Ficha ${clinOwner(name)}. ${clinCapital(parts[0])}` : `Ficha ${clinOwner(name)}: ${parts[0]}`);
  let told = 1;
  for (const part of parts.slice(1)) {
    const next = `${speech} ${clinPeriod(clinCapital(part))}`;
    if (next.length > CLIN_SPEECH_MAX) break;
    speech = next;
    told++;
  }
  if (told < parts.length) speech += ' O resto da ficha está na tela do paciente.';
  return { ok: true, speech, profile };
}

export interface ClinicalUpdateInput { field?: unknown; add?: unknown; remove?: unknown; value?: unknown }

/**
 * Muda uma parte da ficha por voz: inclui ou tira itens de uma lista, troca sexo ou nível de atividade,
 * ou substitui as observações. Grava só o campo mudado, e a fala confirma exatamente o que mudou.
 */
export async function updateClinicalProfile(db: Firestore, nutritionistId: string, patient: { uid: string; name: string }, input: ClinicalUpdateInput, source: 'app' | 'ali' = 'ali', now = new Date()): Promise<ActionResult> {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const name = clinNameOf(patient);
  const owner = clinOwner(name);
  const field = clinFieldOf(raw.field);
  if (!field) {
    return { ok: false, status: 422, speech: `${cleanText(raw.field, 60) ? 'Não conheço essa parte da ficha.' : 'Em qual parte da ficha?'} Posso anotar ${CLIN_FIELDS_SPOKEN}.` };
  }
  const opened = await clinOpen(db, nutritionistId, patient?.uid);
  if (!opened.ok) {
    return opened.status === 404
      ? { ok: false, status: 404, speech: 'Não encontrei esse paciente entre os seus. Pode repetir o nome?' }
      : { ok: false, status: 409, speech: 'Não consegui abrir a ficha desse paciente agora. Nada foi mudado.' };
  }
  const { ref, profile } = opened;
  const updatedAt = now.toISOString();
  const updatedBy: 'app' | 'ali' = source === 'app' ? 'app' : 'ali';
  const save = async (value: unknown, speech: string): Promise<ActionResult> => {
    await ref.set({ nutritionistId, patientUid: patient.uid, [field]: value, updatedAt, updatedBy }, { merge: true });
    return { ok: true, speech, field, profile: { ...profile, [field]: value, updatedAt, updatedBy } };
  };
  const clear = raw.remove !== undefined && raw.remove !== null && raw.remove !== false && raw.remove !== '';

  if (field === 'sex') {
    if (clear) return save(null, `Tirei o sexo da ficha ${owner}.`);
    const sex = clinSexOf(clinValueOf(raw));
    if (!sex) return { ok: false, status: 422, speech: 'O sexo na ficha é feminino ou masculino?' };
    return save(sex, `Anotei na ficha ${owner}: sexo ${sex === 'F' ? 'feminino' : 'masculino'}.`);
  }
  if (field === 'activity') {
    if (clear) return save(null, `Tirei o nível de atividade da ficha ${owner}.`);
    const activity = clinActivityOf(clinValueOf(raw));
    if (!activity) return { ok: false, status: 422, speech: 'Qual é o nível de atividade: sedentário, leve, moderado, intenso ou muito intenso?' };
    return save(activity, `Anotei na ficha ${owner}: nível de atividade ${CLIN_ACTIVITY_LABELS[activity]}.`);
  }
  if (field === 'notes') {
    if (clear) return save('', `Apaguei as observações da ficha ${owner}.`);
    const value = clinValueOf(raw);
    const text = cleanText(value, CLINICAL_LIMITS.notes + 1);
    if (text.length > CLINICAL_LIMITS.notes) return { ok: false, status: 422, speech: 'As observações passaram de mil caracteres. Resuma um pouco, por favor.' };
    if (text.length < 2) return { ok: false, status: 422, speech: 'O que você quer deixar nas observações da ficha?' };
    return save(text, `Observações da ficha ${owner} atualizadas: ${clinPeriod(clinClip(text, 200))}`);
  }
  if (!clinIsList(field)) return { ok: false, status: 422, speech: `Posso anotar ${CLIN_FIELDS_SPOKEN}.` };

  const place = CLIN_PLACES[field];
  const current = [...profile[field]];
  // Tirar: pelo nome do item (sem acento, ou só algumas palavras dele). "amendoim e leite" tira os dois.
  const removed: string[] = [];
  const removeText = cleanText(raw.remove, 300);
  const removeParts = Array.isArray(raw.remove)
    ? raw.remove.slice(0, 20).map((item) => cleanText(item, 300)).filter(Boolean)
    : !removeText ? [] : clinMatchItems(current, removeText).length ? [removeText] : clinSplitItems(removeText);
  for (const part of removeParts) {
    const matches = clinMatchItems(current, part);
    if (!matches.length) {
      return { ok: false, status: 404, speech: current.length
        ? `Não achei ${clinClip(part, 60)} ${place.into} ${owner}. A lista tem: ${clinSpokenItems(current, 8)}. Qual você quer tirar?`
        : `Não há nada anotado ${place.into} ${owner}.` };
    }
    if (matches.length > 1) return { ok: false, status: 409, speech: `Encontrei mais de um item ${place.into} ${owner}: ${joinPt(matches.slice(0, 3))}. Qual deles?` };
    current.splice(current.indexOf(matches[0]), 1);
    removed.push(matches[0]);
  }

  // Incluir: um texto ("amendoim, camarão e leite") ou uma lista; o que já estava não se repete.
  const addInput = raw.add !== undefined && raw.add !== null && raw.add !== '' ? raw.add : raw.remove === undefined ? raw.value : undefined;
  const candidates = Array.isArray(addInput) ? addInput.slice(0, 50) : typeof addInput === 'string' ? clinSplitItems(cleanText(addInput, 2000)) : [];
  const added: string[] = [];
  const already: string[] = [];
  for (const candidate of candidates) {
    const item = clinCleanItem(candidate);
    const key = normalizeName(item);
    if (item.length < 2 || !key) continue;
    if (item.length > CLINICAL_LIMITS.item) return { ok: false, status: 422, speech: 'Esse item ficou longo demais para a ficha. Diga em poucas palavras, ou deixe o detalhe nas observações.' };
    if (current.some((other) => normalizeName(other) === key)) { if (!already.includes(item)) already.push(item); continue; }
    if (added.some((other) => normalizeName(other) === key)) continue;
    added.push(item);
  }
  if (!removed.length && !added.length && !already.length) return { ok: false, status: 422, speech: `O que você quer incluir ${place.into} ${owner}?` };
  if (current.length + added.length > CLINICAL_LIMITS.perList) {
    const room = CLINICAL_LIMITS.perList - current.length;
    return { ok: false, status: 422, speech: room <= 0
      ? `Não cabe mais nada ${place.into} ${owner}: o limite é de ${CLINICAL_LIMITS.perList} itens por lista. Tire algum antes de incluir outro.`
      : `Só ${room === 1 ? 'cabe mais 1 item' : `cabem mais ${room} itens`} ${place.into} ${owner}: o limite é de ${CLINICAL_LIMITS.perList} por lista.` };
  }
  if (!removed.length && !added.length) {
    return { ok: true, speech: `${clinCapital(clinSpokenItems(already))} já ${already.length === 1 ? 'estava' : 'estavam'} ${place.into} ${owner}.`, field, profile };
  }
  const said: string[] = [];
  if (removed.length) said.push(`Tirei ${joinPt(removed)} ${place.from} ${owner}.`);
  if (added.length) said.push(`Incluí ${clinSpokenItems(added, 8)} ${place.into} ${owner}.`);
  if (already.length) said.push(`${clinCapital(clinSpokenItems(already))} já ${already.length === 1 ? 'estava' : 'estavam'} na lista.`);
  return save([...current, ...added], said.join(' '));
}

/** Para a IA que monta o rascunho do plano: só o que está preenchido, com chaves em português e sem o nome do paciente. */
export function clinicalContextForPlan(profile: ClinicalProfile): Record<string, unknown> | null {
  const clean = sanitizeClinicalProfile(profile);
  const out: Record<string, unknown> = {};
  for (const list of CLINICAL_LISTS) if (clean[list.key].length) out[CLIN_PT_KEYS[list.key]] = [...clean[list.key]];
  if (clean.sex) out.sexo = clean.sex === 'F' ? 'feminino' : 'masculino';
  if (clean.activity) out.nivelDeAtividade = CLIN_ACTIVITY_LABELS[clean.activity];
  if (clean.notes) out.observacoes = clean.notes;
  return Object.keys(out).length ? out : null;
}

/** Uma frase para o resumo antes da consulta: alergias, intolerâncias e restrições. Vazia quando não há nenhuma. */
export function clinicalAlertLine(profile: ClinicalProfile): string {
  const clean = sanitizeClinicalProfile(profile);
  const parts = [
    clean.allergies.length ? `alergia a ${clinSpokenItems(clean.allergies)}` : '',
    clean.intolerances.length ? `intolerância a ${clinSpokenItems(clean.intolerances)}` : '',
    clean.restrictions.length ? `${clean.restrictions.length === 1 ? 'restrição alimentar' : 'restrições alimentares'}: ${clinSpokenItems(clean.restrictions)}` : '',
  ].filter(Boolean);
  return parts.length ? `Atenção na ficha: ${parts.join('; ')}.` : '';
}

/** Restrições que são um jeito de comer, não um ingrediente: procurar a palavra no plano daria alarme falso. */
const CLIN_DIET_PATTERNS = new Set(['vegetariano', 'vegetariana', 'vegano', 'vegana', 'ovolactovegetariano', 'ovolactovegetariana', 'lactovegetariano', 'lactovegetariana',
  'pescetariano', 'pescetariana', 'flexitariano', 'flexitariana', 'low carb', 'lowcarb', 'cetogenica', 'cetogenico', 'dieta cetogenica', 'keto', 'kosher', 'halal', 'jejum intermitente']);

/**
 * O que a conferência do plano procura nos itens: cada alergia, intolerância, restrição e aversão. Um item digitado na
 * tela com vários alimentos ("amendoim, camarão", "leite e derivados") vira um termo para cada um, e o que está entre
 * parênteses ("castanhas (anafilaxia)") fica de fora da procura.
 */
export function clinicalAvoidTerms(profile: ClinicalProfile): { label: string; term: string }[] {
  const clean = sanitizeClinicalProfile(profile);
  const out: { label: string; term: string }[] = [];
  const seen = new Set<string>();
  const add = (label: string, items: string[], skipDietPatterns = false) => {
    for (const item of items) {
      for (const term of clinSplitItems(item.replace(/\([^)]*\)/g, ' '))) {
        const key = `${label}|${normalizeName(term)}`;
        if (term.length < 2 || seen.has(key) || (skipDietPatterns && CLIN_DIET_PATTERNS.has(normalizeName(term)))) continue;
        seen.add(key);
        out.push({ label, term });
      }
    }
  };
  add('alergia', clean.allergies);
  add('intolerância', clean.intolerances);
  add('restrição', clean.restrictions, true);
  add('não gosta', clean.dislikes);
  return out;
}

/** LGPD, arquivo "meus dados": as fichas desse paciente (de qualquer nutricionista), sem dizer de quem é a conta. */
export async function exportClinicalProfiles(db: Firestore, patientUid: string): Promise<Record<string, unknown>[]> {
  if (!clinValidId(patientUid)) return [];
  const snap = await db.collection(CLINICAL_COLLECTION).where('patientUid', '==', patientUid).get();
  return snap.docs
    .map((doc) => doc.data() || {})
    .filter((data) => data.patientUid === patientUid)
    .map((data) => {
      const clean = sanitizeClinicalProfile(data);
      const out: Record<string, unknown> = { sexo: clean.sex === 'F' ? 'feminino' : clean.sex === 'M' ? 'masculino' : null, nivelDeAtividade: clean.activity ? CLIN_ACTIVITY_LABELS[clean.activity] : null };
      for (const list of CLINICAL_LISTS) out[CLIN_PT_KEYS[list.key]] = clean[list.key];
      out.observacoes = clean.notes;
      out.atualizadaEm = clean.updatedAt;
      out.atualizadaPor = clean.updatedBy === 'ali' ? 'nutricionista, pela Ali' : clean.updatedBy === 'app' ? 'nutricionista, pelo aplicativo' : null;
      return out;
    })
    .sort((a, b) => String(a.atualizadaEm || '').localeCompare(String(b.atualizadaEm || '')));
}

/** LGPD, exclusão: apaga as fichas desse paciente em todas as contas. Devolve quantas foram apagadas. */
export async function eraseClinicalProfiles(db: Firestore, patientUid: string): Promise<number> {
  if (!clinValidId(patientUid)) return 0;
  const snap = await db.collection(CLINICAL_COLLECTION).where('patientUid', '==', patientUid).get();
  let erased = 0;
  for (const doc of snap.docs) {
    if ((doc.data() || {}).patientUid !== patientUid) continue;
    await doc.ref.delete();
    erased++;
  }
  return erased;
}
