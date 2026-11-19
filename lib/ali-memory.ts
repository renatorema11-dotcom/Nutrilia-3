// Memória da Ali da nutricionista: o jeito de trabalhar dela (preferências) e as pendências que ela pediu para lembrar.
// Somente no servidor. Fica na coleção aliMemory, um documento por item, sempre com o nutritionistId da dona:
// toda leitura confere esse campo de novo, então uma nutricionista nunca vê nem mexe na memória de outra.
// O paciente não vê nada daqui. A pendência ligada a um paciente guarda o uid e o nome dele (para a LGPD, ver erasePatientMemory).
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { cleanText, normalizeName } from './ali-settings';
import type { ActionResult } from './google-workspace';

export const MEMORY_COLLECTION = 'aliMemory';
export const MEMORY_LIMITS = { text: 300, preferences: 40, openFollowups: 100 };

export interface MemoryPreference { id: string; text: string; createdAt: string; source: 'ali' | 'app' }
export interface MemoryFollowup {
  id: string; text: string; createdAt: string; source: 'ali' | 'app';
  patientUid: string | null; patientName: string | null; dueDate: string | null; status: 'open' | 'done'; doneAt: string | null;
}

const MEM_MIN_TEXT = 3;
/** O que vai para o prompt da IA: cabe sem pesar a conversa. */
const MEM_PROMPT_MAX = 1200;
/** Quanto a Ali fala de uma vez; o resto da lista vira "E mais N". */
const MEM_SPEECH_BUDGET = 560;
const MEM_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MEM_ORDINALS = ['Primeira', 'Segunda', 'Terceira', 'Quarta', 'Quinta', 'Sexta', 'Sétima', 'Oitava'];
const MEM_DUE_SCOPES = new Set(['due', 'hoje', 'today']);
/** Palavras que não ajudam a achar o item: "esqueça a preferência do café" procura só "cafe". */
const MEM_FILLERS = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas', 'que', 'para', 'pra', 'pro',
  'por', 'com', 'sobre', 'essa', 'esse', 'esta', 'este', 'aquela', 'aquele', 'minha', 'meu', 'sua', 'seu',
  'preferencia', 'preferencias', 'pendencia', 'pendencias', 'lembrete', 'lembretes',
]);

const memFields = (input: unknown): Record<string, unknown> => (input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {});
const memHasValue = (value: unknown) => value !== undefined && value !== null && value !== '';
const memValidId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('/');
const memSource = (value: unknown): 'ali' | 'app' => (value === 'app' ? 'app' : 'ali');
const memCompare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Texto em uma linha só, do jeito que a Ali fala e a IA lê. */
const memText = (value: unknown) => cleanText(value, 4000).replace(/\s+/g, ' ').trim();
const memClip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const memPeriod = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`);
const memCapital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
/** "uma pendência", "duas pendências", "5 pendências": os itens daqui são todos palavras femininas. */
const memCount = (n: number, singular: string, plural: string) => (n === 1 ? `uma ${singular}` : n === 2 ? `duas ${plural}` : `${n} ${plural}`);
const memNoOwner = (): ActionResult => ({ ok: false, status: 403, speech: 'Não consegui confirmar a sua conta. Entre de novo no aplicativo.' });

type MemChecked = { ok: true; text: string } | { ok: false; result: ActionResult };

/** Texto do item: de 3 a 300 caracteres e com alguma palavra de verdade. */
function memCheckText(value: unknown, ask: string): MemChecked {
  const text = memText(value);
  if (text.length < MEM_MIN_TEXT || !normalizeName(text)) return { ok: false, result: { ok: false, status: 422, speech: ask } };
  if (text.length > MEMORY_LIMITS.text) return { ok: false, result: { ok: false, status: 422, speech: 'Ficou longo demais para eu guardar. Pode resumir em uma frase curta?' } };
  return { ok: true, text };
}

/** Data AAAA-MM-DD que existe no calendário (31 de fevereiro não passa); senão null. */
function memDateKey(value: unknown): string | null {
  if (typeof value !== 'string' || !MEM_DATE_RE.test(value.trim())) return null;
  const key = value.trim();
  const date = new Date(`${key}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === key ? key : null;
}

const memToday = (todayKey: unknown, now: Date) => memDateKey(todayKey) || now.toISOString().slice(0, 10);

/** "20 de outubro"; com o ano quando não é o ano de hoje ("5 de janeiro de 2027"). */
function memDateLabel(key: string, todayKey: string): string {
  const label = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(new Date(`${key}T12:00:00Z`)).replace(/^1 de /, '1º de ');
  return key.slice(0, 4) === todayKey.slice(0, 4) ? label : `${label} de ${key.slice(0, 4)}`;
}

/** "pedir os exames, de Ana Souza, para 20 de outubro": como a Ali fala uma pendência. Sem todayKey, fica sem a data. */
function memFollowupLabel(item: Pick<MemoryFollowup, 'text' | 'patientName' | 'dueDate'>, todayKey: string | null, max: number, withName = true): string {
  return [
    memClip(item.text, max).replace(/[.;!?]+$/, ''),
    withName && item.patientName ? `de ${item.patientName}` : '',
    todayKey && item.dueDate ? `para ${memDateLabel(item.dueDate, todayKey)}` : '',
  ].filter(Boolean).join(', ');
}

/** Junta as frases até o limite do que a Ali fala de uma vez (sempre ao menos uma); o resto vira "E mais N.". */
function memSpeak(intro: string, sentences: string[], total: number): string {
  let speech = intro;
  let said = 0;
  for (const sentence of sentences) {
    if (said > 0 && speech.length + sentence.length + 1 > MEM_SPEECH_BUDGET) break;
    speech += ` ${sentence}`;
    said++;
  }
  return total > said ? `${speech} E mais ${total - said}.` : speech;
}

/**
 * Acha o item pelas palavras ditas. O texto inteiro igual vence; senão, todas as palavras que importam precisam
 * aparecer inteiras no item (na pendência, vale também o nome do paciente). Mais de um resultado: a Ali pergunta qual.
 */
function memMatch<T extends { text: string; patientName?: string | null }>(items: T[], said: string, withName: boolean): T[] {
  const query = normalizeName(said);
  if (!query) return [];
  const exact = items.filter((item) => normalizeName(item.text) === query);
  if (exact.length) return exact;
  const all = query.split(' ');
  const words = all.filter((word) => !MEM_FILLERS.has(word));
  const needed = words.length ? words : all;
  return items.filter((item) => {
    const haystack = ` ${normalizeName(withName && item.patientName ? `${item.text} ${item.patientName}` : item.text)} `;
    return needed.every((word) => haystack.includes(` ${word} `));
  });
}

/** "Primeira: …. Segunda: …." com no máximo 3 opções, para a Ali perguntar qual. */
const memOptions = (labels: string[]) => labels.slice(0, 3).map((label, i) => `${MEM_ORDINALS[i]}: ${memPeriod(label)}`).join(' ')
  + (labels.length > 3 ? ` E mais ${labels.length - 3}.` : '');

function memPreferenceOf(id: string, d: Record<string, unknown>): MemoryPreference | null {
  const text = memText(d.text);
  return text ? { id, text, createdAt: typeof d.createdAt === 'string' ? d.createdAt : '', source: memSource(d.source) } : null;
}

function memFollowupOf(id: string, d: Record<string, unknown>): MemoryFollowup | null {
  const text = memText(d.text);
  if (!text) return null;
  const patientUid = memValidId(d.patientUid) ? d.patientUid : null;
  const status = d.status === 'done' ? 'done' : 'open';
  return {
    id, text, createdAt: typeof d.createdAt === 'string' ? d.createdAt : '', source: memSource(d.source),
    patientUid, patientName: patientUid ? memText(d.patientName).slice(0, 120) || null : null,
    dueDate: memDateKey(d.dueDate), status, doneAt: status === 'done' && typeof d.doneAt === 'string' ? d.doneAt : null,
  };
}

/** Itens de um tipo da nutricionista. Só filtros de igualdade (sem índice composto); a dona é conferida de novo aqui. */
async function memDocs(db: Firestore, nutritionistId: string, kind: 'preference' | 'followup'): Promise<{ id: string; data: Record<string, unknown> }[]> {
  if (!memValidId(nutritionistId)) return [];
  const snap = await db.collection(MEMORY_COLLECTION).where('nutritionistId', '==', nutritionistId).where('kind', '==', kind).get();
  return snap.docs
    .map((doc) => ({ id: doc.id, data: (doc.data() || {}) as Record<string, unknown> }))
    .filter((doc) => doc.data.nutritionistId === nutritionistId && doc.data.kind === kind);
}

/** Um item pelo id, só se for dessa nutricionista (e do tipo pedido); senão null, como se não existisse. */
async function memOwnItem(db: Firestore, nutritionistId: string, id: unknown, kind: 'preference' | 'followup' | null): Promise<{ ref: DocumentReference; data: Record<string, unknown> } | null> {
  if (!memValidId(id) || !memValidId(nutritionistId)) return null;
  const ref = db.collection(MEMORY_COLLECTION).doc(id);
  const snap = await ref.get();
  const data = snap.exists ? (snap.data() || {}) as Record<string, unknown> : null;
  if (!data || data.nutritionistId !== nutritionistId || (kind && data.kind !== kind)) return null;
  return { ref, data };
}

// ───────────── Preferências (o jeito de trabalhar dela) ─────────────

/** Preferências da nutricionista, da mais antiga para a mais nova. */
export async function loadPreferences(db: Firestore, nutritionistId: string): Promise<MemoryPreference[]> {
  return (await memDocs(db, nutritionistId, 'preference'))
    .map((doc) => memPreferenceOf(doc.id, doc.data))
    .filter((item): item is MemoryPreference => !!item)
    .sort((a, b) => memCompare(a.createdAt, b.createdAt) || memCompare(a.id, b.id));
}

export async function rememberPreference(db: Firestore, nutritionistId: string, input: { text?: unknown }, source: 'ali' | 'app' = 'ali', now = new Date()): Promise<ActionResult> {
  if (!memValidId(nutritionistId)) return memNoOwner();
  const checked = memCheckText(memFields(input).text, 'O que você quer que eu lembre? Diga, por exemplo: prefiro planos com cinco refeições.');
  if (!checked.ok) return checked.result;
  const text = checked.text;
  const saved = await loadPreferences(db, nutritionistId);
  // A mesma frase de novo (com ou sem acento, maiúscula) não vira um item repetido.
  const same = saved.find((item) => normalizeName(item.text) === normalizeName(text));
  if (same) return { ok: true, speech: 'Isso eu já tinha anotado.', preference: { id: same.id, text: same.text }, duplicate: true };
  if (saved.length >= MEMORY_LIMITS.preferences) {
    return { ok: false, status: 409, speech: `Já tenho ${MEMORY_LIMITS.preferences} preferências suas anotadas, que é o máximo. Peça para eu esquecer alguma antes de anotar outra.` };
  }
  const ref = await db.collection(MEMORY_COLLECTION).add({ nutritionistId, kind: 'preference', text, source: memSource(source), createdAt: now.toISOString() });
  return { ok: true, speech: `Anotado. Vou lembrar: ${memPeriod(text)}`, preference: { id: ref.id, text } };
}

export async function listPreferences(db: Firestore, nutritionistId: string): Promise<ActionResult> {
  const preferences = await loadPreferences(db, nutritionistId);
  if (!preferences.length) {
    return { ok: true, speech: 'Ainda não tenho nenhuma preferência sua anotada. Se quiser, é só dizer, por exemplo: lembre que eu prefiro planos com cinco refeições.', preferences: [] };
  }
  if (preferences.length === 1) return { ok: true, speech: `Tenho uma preferência sua anotada: ${memPeriod(memClip(preferences[0].text, 300))}`, preferences };
  const sentences = preferences.slice(0, MEM_ORDINALS.length).map((item, i) => `${MEM_ORDINALS[i]}: ${memPeriod(memClip(item.text, 120))}`);
  return { ok: true, speech: memSpeak(`Tenho ${memCount(preferences.length, 'preferência sua anotada', 'preferências suas anotadas')}.`, sentences, preferences.length), preferences };
}

/** Esquece uma preferência: pelo id (da tela) ou pelas palavras ditas. */
export async function forgetPreference(db: Firestore, nutritionistId: string, input: { id?: unknown; text?: unknown }): Promise<ActionResult> {
  const raw = memFields(input);
  if (memHasValue(raw.id)) {
    const item = await memOwnItem(db, nutritionistId, raw.id, 'preference');
    if (!item) return { ok: false, status: 404, speech: 'Não encontrei essa preferência na sua memória.' };
    const text = memText(item.data.text);
    await item.ref.delete();
    return { ok: true, speech: text ? `Pronto, esqueci: ${memPeriod(memClip(text, 300))}` : 'Pronto, esqueci essa preferência.', removed: { id: item.ref.id, text } };
  }
  const said = memText(raw.text).slice(0, MEMORY_LIMITS.text);
  if (!normalizeName(said)) return { ok: false, status: 422, speech: 'Qual preferência você quer que eu esqueça? Diga uma parte do que eu anotei.' };
  const preferences = await loadPreferences(db, nutritionistId);
  if (!preferences.length) return { ok: false, status: 404, speech: 'Você não tem nenhuma preferência anotada.' };
  const found = memMatch(preferences, said, false);
  if (!found.length) {
    return { ok: false, status: 404, speech: `Não achei nenhuma preferência com ${memClip(said, 80)}. Qual delas você quer que eu esqueça? Se quiser, eu leio a lista.` };
  }
  if (found.length > 1) {
    return { ok: false, status: 409, speech: `Encontrei ${memCount(found.length, 'preferência', 'preferências')} com essas palavras. ${memOptions(found.map((item) => memClip(item.text, 80)))} Qual delas você quer que eu esqueça?` };
  }
  const target = found[0];
  await db.collection(MEMORY_COLLECTION).doc(target.id).delete();
  return { ok: true, speech: `Pronto, esqueci: ${memPeriod(memClip(target.text, 300))}`, removed: { id: target.id, text: target.text } };
}

// ───────────── Pendências (lembretes) ─────────────

/** Pendências: as abertas primeiro; com data, da mais antiga (atrasada) para a mais distante; depois as sem data, por ordem de criação. */
function memFollowupOrder(a: MemoryFollowup, b: MemoryFollowup): number {
  if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
  if (a.status === 'done') return memCompare(b.doneAt || '', a.doneAt || '') || memCompare(a.id, b.id);
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate || !b.dueDate) return a.dueDate ? -1 : 1;
    return memCompare(a.dueDate, b.dueDate);
  }
  return memCompare(a.createdAt, b.createdAt) || memCompare(a.id, b.id);
}

export async function loadFollowups(db: Firestore, nutritionistId: string, options: { patientUid?: string; includeDone?: boolean } = {}): Promise<MemoryFollowup[]> {
  const opts = memFields(options);
  const patientUid = memHasValue(opts.patientUid) ? opts.patientUid : undefined;
  // Filtro de paciente inválido não pode virar "todas": volta vazio.
  if (patientUid !== undefined && !memValidId(patientUid)) return [];
  return (await memDocs(db, nutritionistId, 'followup'))
    .map((doc) => memFollowupOf(doc.id, doc.data))
    .filter((item): item is MemoryFollowup => !!item && (opts.includeDone === true || item.status === 'open') && (!patientUid || item.patientUid === patientUid))
    .sort(memFollowupOrder);
}

/** Pendência nova, ligada ou não a um paciente (já conferido pela rota) e com data opcional, de hoje em diante. */
export async function addFollowup(
  db: Firestore, nutritionistId: string, patient: { uid: string; name: string } | null, input: { text?: unknown; dueDate?: unknown },
  todayKey: string, source: 'ali' | 'app' = 'ali', now = new Date(),
): Promise<ActionResult> {
  if (!memValidId(nutritionistId)) return memNoOwner();
  const raw = memFields(input);
  const checked = memCheckText(raw.text, 'O que você quer que eu lembre? Diga a pendência, por exemplo: pedir os exames de sangue da Ana.');
  if (!checked.ok) return checked.result;
  const today = memToday(todayKey, now);
  let dueDate: string | null = null;
  if (memHasValue(raw.dueDate)) {
    dueDate = memDateKey(raw.dueDate);
    if (!dueDate) return { ok: false, status: 422, speech: 'Não entendi a data da pendência. Diga o dia, o mês e o ano, ou deixe sem data.' };
    if (dueDate < today) return { ok: false, status: 422, speech: 'Essa data já passou. Para quando é a pendência? Pode ser de hoje em diante, ou sem data.' };
  }
  const patientUid = patient && memValidId(patient.uid) ? patient.uid : null;
  const patientName = patient && patientUid ? memText(patient.name).slice(0, 120) || null : null;

  const open = await loadFollowups(db, nutritionistId);
  // O mesmo pedido repetido (mesmo texto, paciente e data) não vira duas pendências.
  const same = open.find((item) => normalizeName(item.text) === normalizeName(checked.text) && item.patientUid === patientUid && item.dueDate === dueDate);
  if (same) return { ok: true, speech: 'Essa pendência já estava anotada.', followup: same, duplicate: true };
  if (open.length >= MEMORY_LIMITS.openFollowups) {
    return { ok: false, status: 409, speech: `Você já tem ${MEMORY_LIMITS.openFollowups} pendências abertas, que é o máximo. Conclua ou apague algumas antes de anotar outra.` };
  }
  const fields = { text: checked.text, createdAt: now.toISOString(), source: memSource(source), patientUid, patientName, dueDate, status: 'open' as const, doneAt: null };
  const ref = await db.collection(MEMORY_COLLECTION).add({ nutritionistId, kind: 'followup', ...fields });
  const followup: MemoryFollowup = { id: ref.id, ...fields };
  return { ok: true, speech: `Pendência anotada: ${memPeriod(memFollowupLabel(followup, today, 300))}`, followup };
}

/** Pendências abertas para a Ali falar; scope 'due' = só as atrasadas e as de hoje. */
export async function listFollowups(db: Firestore, nutritionistId: string, input: { patientUid?: string; scope?: unknown }, todayKey: string): Promise<ActionResult> {
  const raw = memFields(input);
  const today = memToday(todayKey, new Date());
  const dueOnly = typeof raw.scope === 'string' && MEM_DUE_SCOPES.has(normalizeName(raw.scope));
  const byPatient = memHasValue(raw.patientUid);
  const open = await loadFollowups(db, nutritionistId, { patientUid: raw.patientUid as string | undefined });
  const list = dueOnly ? open.filter((item) => item.dueDate !== null && item.dueDate <= today) : open;
  const overdue = list.filter((item) => item.dueDate !== null && item.dueDate < today).length;
  const dueToday = list.filter((item) => item.dueDate === today).length;
  const extra = { followups: list, total: list.length, overdue, dueToday };

  if (!list.length) {
    if (!dueOnly) return { ok: true, speech: byPatient ? 'Não há pendências abertas desse paciente.' : 'Você não tem pendências abertas.', ...extra };
    const later = open.length ? ` Há ${memCount(open.length, 'pendência aberta', 'pendências abertas')} para outros dias ou sem data.` : '';
    return { ok: true, speech: `Nenhuma pendência para hoje nem atrasada.${later}`, ...extra };
  }
  // Com o filtro de paciente, o nome entra uma vez só, na abertura.
  const name = byPatient ? list[0].patientName : null;
  const whose = name ? ` de ${name}` : '';
  const late = !overdue ? '' : list.length === 1 ? ', que está atrasada'
    : overdue === list.length ? `, ${list.length === 2 ? 'as duas' : 'todas'} atrasadas` : `, ${memCount(overdue, 'atrasada', 'atrasadas')}`;
  let intro: string;
  if (!dueOnly) intro = `Você tem ${memCount(list.length, 'pendência aberta', 'pendências abertas')}${whose}${late}.`;
  else if (overdue && dueToday) intro = `Você tem ${memCount(list.length, 'pendência', 'pendências')}${whose} para resolver: ${memCount(overdue, 'atrasada', 'atrasadas')} e ${memCount(dueToday, 'para hoje', 'para hoje')}.`;
  else if (overdue) intro = `Você tem ${memCount(overdue, 'pendência atrasada', 'pendências atrasadas')}${whose}.`;
  else intro = `Para hoje, você tem ${memCount(dueToday, 'pendência', 'pendências')}${whose}.`;
  const sentences = list.slice(0, 6).map((item) => memPeriod(memCapital(memFollowupLabel(item, today, 100, !name))));
  return { ok: true, speech: memSpeak(intro, sentences, list.length), ...extra };
}

/** Marca uma pendência aberta como feita: pelo id (da tela) ou pelas palavras ditas, opcionalmente só entre as de um paciente. */
export async function completeFollowup(db: Firestore, nutritionistId: string, input: { id?: unknown; text?: unknown; patientUid?: string }, now = new Date()): Promise<ActionResult> {
  const raw = memFields(input);
  const patientUid = memHasValue(raw.patientUid) ? raw.patientUid : undefined;
  const finish = async (ref: DocumentReference, followup: MemoryFollowup): Promise<ActionResult> => {
    const doneAt = now.toISOString();
    await ref.update({ status: 'done', doneAt });
    return { ok: true, speech: `Pronto, pendência concluída: ${memPeriod(memFollowupLabel(followup, null, 300))}`, followup: { ...followup, status: 'done', doneAt } };
  };

  if (memHasValue(raw.id)) {
    const item = await memOwnItem(db, nutritionistId, raw.id, 'followup');
    const followup = item ? memFollowupOf(item.ref.id, item.data) : null;
    if (!item || !followup || (patientUid !== undefined && followup.patientUid !== patientUid)) return { ok: false, status: 404, speech: 'Não encontrei essa pendência.' };
    if (followup.status === 'done') return { ok: true, speech: 'Essa pendência já estava concluída.', followup, alreadyDone: true };
    return finish(item.ref, followup);
  }

  const said = memText(raw.text).slice(0, MEMORY_LIMITS.text);
  // Sem texto só dá para saber qual é quando ela falou de um paciente que tem uma pendência só.
  if (!normalizeName(said) && patientUid === undefined) return { ok: false, status: 422, speech: 'Qual pendência você quer concluir? Diga uma parte do que eu anotei.' };
  const open = await loadFollowups(db, nutritionistId, { patientUid: patientUid as string | undefined });
  if (!open.length) return { ok: false, status: 404, speech: patientUid !== undefined ? 'Não há pendências abertas desse paciente.' : 'Você não tem pendências abertas.' };
  const found = normalizeName(said) ? memMatch(open, said, true) : open;
  if (!found.length) return { ok: false, status: 404, speech: `Não achei nenhuma pendência aberta com ${memClip(said, 80)}. Qual delas você quer concluir? Se quiser, eu leio a lista.` };
  if (found.length > 1) {
    return { ok: false, status: 409, speech: `Encontrei ${memCount(found.length, 'pendência aberta', 'pendências abertas')}${normalizeName(said) ? ' com essas palavras' : ''}. ${memOptions(found.map((item) => memFollowupLabel(item, null, 80)))} Qual delas você quer concluir?` };
  }
  return finish(db.collection(MEMORY_COLLECTION).doc(found[0].id), found[0]);
}

// ───────────── Tela, prompt e LGPD ─────────────

/** Apaga qualquer item dela (preferência ou pendência). false quando não existe ou é de outra pessoa. */
export async function removeMemoryItem(db: Firestore, nutritionistId: string, id: unknown): Promise<boolean> {
  const item = await memOwnItem(db, nutritionistId, id, null);
  if (!item) return false;
  await item.ref.delete();
  return true;
}

/** As preferências dela num texto só para o prompt da IA: "1) …; 2) …", cortado entre itens. Vazio quando não há nenhuma. */
export async function memoryForPrompt(db: Firestore, nutritionistId: string): Promise<string> {
  const items = (await loadPreferences(db, nutritionistId)).map((item) => item.text.slice(0, MEMORY_LIMITS.text).replace(/[\s.;]+$/, '')).filter(Boolean);
  let prompt = '';
  for (let i = 0; i < items.length; i++) {
    const next = `${prompt ? `${prompt}; ` : ''}${i + 1}) ${items[i]}`;
    if (next.length > MEM_PROMPT_MAX) break;
    prompt = next;
  }
  return prompt;
}

/** LGPD: apaga as pendências ligadas a esse paciente, de qualquer nutricionista. Devolve quantas apagou. */
export async function erasePatientMemory(db: Firestore, patientUid: string): Promise<number> {
  if (!memValidId(patientUid)) return 0;
  const snap = await db.collection(MEMORY_COLLECTION).where('patientUid', '==', patientUid).get();
  await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
  return snap.docs.length;
}
