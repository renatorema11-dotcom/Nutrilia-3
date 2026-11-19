// Calculadoras da Ali da nutricionista: gasto energético, IMC, divisão de macros e conferência do plano pela TACO.
// Funções puras (sem banco e sem segredos): servem para a voz e para o MCP. Pelas regras do CFN a Ali só apoia:
// tudo aqui é estimativa e quem decide é a nutricionista. Só usamos as fórmulas e os pontos de corte escritos aqui,
// com a fonte de cada um; nada de limite clínico inventado.
import { cleanText, joinPt, normalizeName } from './ali-settings';
import type { ActionResult } from './google-workspace';
import { dayTotals } from './plan-nutrition';

export type CalcSex = 'F' | 'M';
export type CalcActivity = 'sedentario' | 'leve' | 'moderado' | 'intenso' | 'muito_intenso';
export type CalcFormula = 'mifflin' | 'harris';

/** Fatores de atividade sobre o gasto em repouso. */
export const CALC_ACTIVITY_FACTORS: Record<CalcActivity, number> = { sedentario: 1.2, leve: 1.375, moderado: 1.55, intenso: 1.725, muito_intenso: 1.9 };

const CALC_NOTE = 'É uma estimativa para apoiar a sua decisão.';
const CALC_PLAN_NOTE = 'É uma estimativa pela tabela TACO, para apoiar a sua decisão.';
const CALC_ACTIVITY_LABELS: Record<CalcActivity, string> = { sedentario: 'sedentária', leve: 'leve', moderado: 'moderada', intenso: 'intensa', muito_intenso: 'muito intensa' };
const CALC_ACTIVITY_ALIASES = new Map<string, CalcActivity>([
  ['sedentario', 'sedentario'], ['sedentaria', 'sedentario'], ['leve', 'leve'], ['levemente ativo', 'leve'], ['levemente ativa', 'leve'],
  ['moderado', 'moderado'], ['moderada', 'moderado'], ['moderadamente ativo', 'moderado'], ['moderadamente ativa', 'moderado'],
  ['intenso', 'intenso'], ['intensa', 'intenso'], ['muito intenso', 'muito_intenso'], ['muito intensa', 'muito_intenso'],
]);
const CALC_SEX_ALIASES = new Map<string, CalcSex>([
  ['f', 'F'], ['fem', 'F'], ['feminino', 'F'], ['feminina', 'F'], ['mulher', 'F'], ['female', 'F'],
  ['m', 'M'], ['masc', 'M'], ['masculino', 'M'], ['masculina', 'M'], ['homem', 'M'], ['male', 'M'],
]);
const CALC_FORMULA_NAMES: Record<CalcFormula, string> = { mifflin: 'Mifflin-St Jeor', harris: 'Harris-Benedict revisada' };

const calcFields = (input: unknown): Record<string, unknown> => (input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {});
const calcGiven = (value: unknown) => value !== undefined && value !== null && value !== '';
const calcAsk = (speech: string): ActionResult => ({ ok: false, status: 422, speech });
const calcRound = (value: number, digits = 0) => Math.round(value * 10 ** digits) / 10 ** digits;
/** Número falado: "72,4", "1.800", "1,6". */
const calcSpoken = (value: number, digits = 1) => value.toLocaleString('pt-BR', { maximumFractionDigits: digits });
const calcGrams = (value: number) => `${calcSpoken(value)} ${value === 1 ? 'grama' : 'gramas'}`;

/**
 * Número ditado: 72.4, "72,4", "1.800" (milhar com ponto), "1,70 m", "30 por cento". NaN quando não dá para ler.
 * A unidade no fim é ignorada: quem diz o que o número significa é o campo.
 */
function calcNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string' || value.length > 30) return NaN;
  const text = value.toLowerCase().replace(/[\sa-zçãâáàéêíóôõú%/.]+$/, '').trim();
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(text)) return Number(text.replace(/\./g, '').replace(',', '.'));
  return /^\d+([.,]\d+)?$/.test(text) ? Number(text.replace(',', '.')) : NaN;
}

/** Altura em centímetros; abaixo de 3 foi dita em metros (1,70 vira 170). */
function calcHeight(value: unknown): number {
  const n = calcNumber(value);
  return n > 0 && n < 3 ? calcRound(n * 100, 1) : calcRound(n, 1);
}

const calcSex = (value: unknown): CalcSex | null => (typeof value === 'string' ? CALC_SEX_ALIASES.get(normalizeName(value).replace(/^sexo /, '')) ?? null : null);

/** Peso e altura de adulto, conferidos. Devolve a pergunta para a Ali quando falta ou está fora da faixa. */
function calcBody(raw: Record<string, unknown>): { weight: number; height: number } | ActionResult {
  const weight = calcRound(calcNumber(raw.weight), 1);
  if (!(weight >= 30 && weight <= 300)) return calcAsk('Qual é o peso, em quilos? Preciso de um valor entre 30 e 300.');
  const height = calcHeight(raw.height);
  if (!(height >= 120 && height <= 230)) return calcAsk('Qual é a altura? Pode ser em centímetros, como 165, ou em metros, como 1,65.');
  return { weight, height };
}

const calcHeightSpoken = (height: number) => `${(height / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${height >= 200 ? 'metros' : 'metro'}`;

/**
 * Gasto energético de adulto, em calorias por dia. Mifflin-St Jeor (1990) é o padrão; Harris-Benedict revisada por
 * Roza e Shizgal (1984) quando ela pedir. O total é o gasto em repouso vezes o fator de atividade.
 */
export function energyNeeds(input: { weight?: unknown; height?: unknown; age?: unknown; sex?: unknown; activity?: unknown; formula?: unknown }): ActionResult {
  const raw = calcFields(input);
  const body = calcBody(raw);
  if ('ok' in body) return body;
  const { weight, height } = body;
  const rawAge = calcNumber(raw.age);
  if (!(rawAge >= 0 && rawAge <= 130)) return calcAsk('Qual é a idade, em anos?');
  const age = Math.floor(rawAge);
  if (age < 18) return calcAsk('As fórmulas que eu uso aqui são para adultos, a partir de 18 anos. Para crianças e adolescentes o cálculo é outro.');
  if (age > 100) return calcAsk('A idade precisa ficar entre 18 e 100 anos para essas fórmulas.');
  const sex = calcSex(raw.sex);
  if (!sex) return calcAsk('As fórmulas mudam conforme o sexo. É do sexo feminino ou masculino?');
  const activity = calcGiven(raw.activity) ? (typeof raw.activity === 'string' ? CALC_ACTIVITY_ALIASES.get(normalizeName(raw.activity)) : undefined) : 'sedentario';
  if (!activity) return calcAsk('Qual é o nível de atividade: sedentário, leve, moderado, intenso ou muito intenso?');
  const formulaText = typeof raw.formula === 'string' ? normalizeName(raw.formula) : '';
  const formula: CalcFormula | null = !calcGiven(raw.formula) ? 'mifflin' : formulaText.startsWith('mifflin') ? 'mifflin' : formulaText.startsWith('harris') ? 'harris' : null;
  if (!formula) return calcAsk('Posso usar a fórmula de Mifflin-St Jeor ou a de Harris-Benedict. Qual você prefere?');

  const exactBmr = formula === 'mifflin'
    ? 10 * weight + 6.25 * height - 5 * age + (sex === 'M' ? 5 : -161)
    : sex === 'M' ? 88.362 + 13.397 * weight + 4.799 * height - 5.677 * age : 447.593 + 9.247 * weight + 3.098 * height - 4.330 * age;
  const factor = CALC_ACTIVITY_FACTORS[activity];
  const bmr = Math.round(exactBmr);
  const tee = Math.round(exactBmr * factor);
  const person = `${sex === 'F' ? 'uma mulher' : 'um homem'} de ${age} anos, com ${calcSpoken(weight)} quilos e ${calcHeightSpoken(height)}`;
  return {
    ok: true,
    speech: `Para ${person}, pela fórmula de ${CALC_FORMULA_NAMES[formula]}, o gasto em repouso fica em cerca de ${calcSpoken(bmr)} calorias por dia. `
      + `Com atividade ${CALC_ACTIVITY_LABELS[activity]}, fator ${calcSpoken(factor, 3)}, o gasto total fica em cerca de ${calcSpoken(tee)} calorias por dia. ${CALC_NOTE}`,
    formula, bmr, tee, factor,
    inputs: { weight, height, age, sex, activity },
  };
}

type CalcBmiClass = 'baixo peso' | 'eutrofia' | 'sobrepeso' | 'obesidade grau 1' | 'obesidade grau 2' | 'obesidade grau 3';

/** Adultos de 18 a 59 anos, pela OMS. O IMC já vem com uma casa, como é dito, para a faixa bater com o número. */
function calcAdultClass(bmi: number): CalcBmiClass {
  if (bmi < 18.5) return 'baixo peso';
  if (bmi < 25) return 'eutrofia';
  if (bmi < 30) return 'sobrepeso';
  if (bmi < 35) return 'obesidade grau 1';
  if (bmi < 40) return 'obesidade grau 2';
  return 'obesidade grau 3';
}

/** Idosos (60 anos ou mais), por Lipschitz (1994), como o SISVAN usa: até 22 baixo peso, acima de 22 e abaixo de 27 adequado, 27 ou mais sobrepeso. */
const calcElderlyClass = (bmi: number): CalcBmiClass => (bmi <= 22 ? 'baixo peso' : bmi < 27 ? 'eutrofia' : 'sobrepeso');

/** IMC com a classificação e a faixa de peso adequado para a altura. Menor de 18 anos usa as curvas da OMS, fora daqui. */
export function bodyMetrics(input: { weight?: unknown; height?: unknown; age?: unknown }): ActionResult {
  const raw = calcFields(input);
  const body = calcBody(raw);
  if ('ok' in body) return body;
  const { weight, height } = body;
  const hasAge = calcGiven(raw.age);
  const rawAge = hasAge ? calcNumber(raw.age) : NaN;
  if (hasAge && !(rawAge >= 0 && rawAge <= 130)) return calcAsk('Não entendi a idade. Quantos anos tem?');
  const age = hasAge ? Math.floor(rawAge) : null;
  if (age !== null && age < 18) return calcAsk('Para menores de 18 anos, a avaliação usa as curvas de crescimento da OMS, com IMC por idade, e esse cálculo eu não faço aqui.');

  const meters = height / 100;
  const bmi = calcRound(weight / (meters * meters), 1);
  const elderly = age !== null && age >= 60;
  const classification = elderly ? calcElderlyClass(bmi) : calcAdultClass(bmi);
  const [low, high] = elderly ? [22, 27] : [18.5, 24.9];
  const healthyRange = { min: calcRound(low * meters * meters, 1), max: calcRound(high * meters * meters, 1) };
  const reference = elderly ? 'Lipschitz (1994), para idosos, usada pelo SISVAN' : 'OMS, para adultos';
  const said = classification === 'eutrofia' ? 'eutrofia, ou seja, peso adequado,' : classification;
  return {
    ok: true,
    speech: `O IMC fica em ${calcSpoken(bmi)}, o que é ${said} pela classificação ${elderly ? 'de Lipschitz para idosos, usada pelo SISVAN' : 'da OMS para adultos'}. `
      + (age === null ? 'Como não tenho a idade, usei a tabela de adultos. ' : '')
      + `Com ${calcHeightSpoken(height)}, a faixa de peso adequado vai de ${calcSpoken(healthyRange.min)} a ${calcSpoken(healthyRange.max)} quilos. ${CALC_NOTE}`,
    bmi, classification, reference, healthyRange,
    inputs: { weight, height, age },
  };
}

/**
 * Divide as calorias do dia em proteína, gordura e carboidrato. Proteína por quilo de peso (1,6 se ela não disser);
 * sem o peso, 20% das calorias. Gordura em percentual das calorias (30 se ela não disser). Carboidrato é o que sobra.
 */
export function macroSplit(input: { kcal?: unknown; weight?: unknown; proteinPerKg?: unknown; fatPercent?: unknown }): ActionResult {
  const raw = calcFields(input);
  const kcal = Math.round(calcNumber(raw.kcal));
  if (!(kcal >= 800 && kcal <= 6000)) return calcAsk('Para quantas calorias por dia? Preciso de um valor entre 800 e 6.000.');
  const weight = calcGiven(raw.weight) ? calcRound(calcNumber(raw.weight), 1) : null;
  if (weight !== null && !(weight >= 30 && weight <= 300)) return calcAsk('Qual é o peso, em quilos? Preciso de um valor entre 30 e 300.');
  const perKgGiven = calcGiven(raw.proteinPerKg);
  const perKg = perKgGiven ? calcRound(calcNumber(raw.proteinPerKg), 2) : 1.6;
  if (!(perKg >= 0.6 && perKg <= 3.5)) return calcAsk('A proteína por quilo precisa ficar entre 0,6 e 3,5 gramas.');
  // Ela disse a proteína por quilo: sem o peso, trocar pelos 20% mudaria o que ela pediu. Melhor perguntar.
  if (perKgGiven && weight === null) return calcAsk(`Para usar ${calcGrams(perKg)} de proteína por quilo, preciso do peso. Qual é o peso, em quilos?`);
  const fatPercent = calcGiven(raw.fatPercent) ? calcRound(calcNumber(raw.fatPercent), 1) : 30;
  if (!(fatPercent >= 15 && fatPercent <= 45)) return calcAsk('A gordura precisa ficar entre 15 e 45 por cento das calorias.');

  const proteinGrams = weight !== null ? perKg * weight : (kcal * 0.2) / 4;
  const proteinKcal = proteinGrams * 4;
  const fatKcal = (kcal * fatPercent) / 100;
  const carbsKcal = kcal - proteinKcal - fatKcal;
  if (carbsKcal < 0) return calcAsk('Com essa proteína e essa gordura, não sobra caloria para o carboidrato. Quer diminuir a proteína ou a gordura?');
  const part = (grams: number, partKcal: number) => ({ grams: Math.round(grams), kcal: Math.round(partKcal), percent: Math.round((partKcal / kcal) * 100) });
  const protein = part(proteinGrams, proteinKcal);
  const fat = part(fatKcal / 9, fatKcal);
  const carbs = part(carbsKcal / 4, carbsKcal);
  return {
    ok: true,
    speech: `Para ${calcSpoken(kcal)} calorias por dia: proteína, ${calcGrams(protein.grams)}, `
      + (weight !== null ? `que são ${calcGrams(perKg)} por quilo e ` : '')
      + `${protein.percent} por cento das calorias; gordura, ${calcGrams(fat.grams)}, ${fat.percent} por cento; `
      + `e carboidrato, ${calcGrams(carbs.grams)}, ${carbs.percent} por cento. `
      + (weight === null ? 'Sem o peso, usei 20 por cento das calorias para a proteína. ' : '')
      + CALC_NOTE,
    kcal, protein, carbs, fat,
    proteinPerKg: weight !== null ? perKg : null, weight, fatPercent,
  };
}

// ───────────── Conferência do plano ─────────────

const CALC_PLAN_MAX_DAYS = 14;
const CALC_AVOID_MAX = 100;
const CALC_FLAGS_MAX = 30;
const CALC_FLAGS_SPOKEN = 4;
/** Palavras que, logo antes do termo, dizem que ele NÃO está no item ("leite sem lactose", "zero açúcar"). */
const CALC_NEGATIONS = new Set(['sem', 'zero', 'nao']);

/** Singular simples, para "ovo" achar "ovos" e "camarão" achar "camarões". Os dois lados passam por aqui. */
function calcSingular(word: string): string {
  if (word.length > 3 && word.endsWith('ns')) return `${word.slice(0, -2)}m`;
  if (word.length >= 4 && /(oes|aes|aos)$/.test(word)) return `${word.slice(0, -3)}ao`;
  if (word.length > 4 && /eis$/.test(word)) return `${word.slice(0, -3)}el`;
  if (word.length > 4 && /ais$/.test(word)) return `${word.slice(0, -3)}al`;
  if (word.length > 4 && /ois$/.test(word)) return `${word.slice(0, -3)}ol`;
  if (word.length > 4 && /[rsz]es$/.test(word)) return word.slice(0, -2);
  if (word.length > 2 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/** O termo aparece no item como palavra(s) inteira(s), sem negação logo antes ("sem", "zero", "não", "livre de"). */
function calcMentions(itemWords: string[], termWords: string[]): boolean {
  for (let i = 0; i + termWords.length <= itemWords.length; i++) {
    if (!termWords.every((word, j) => calcSingular(itemWords[i + j]) === calcSingular(word))) continue;
    const before = itemWords[i - 1];
    if (before && CALC_NEGATIONS.has(before)) continue;
    if (before === 'de' && ['livre', 'livres', 'isento', 'isenta'].includes(itemWords[i - 2] || '')) continue;
    return true;
  }
  return false;
}

/** O mais grave é dito primeiro: alergia, intolerância, restrição e, por fim, o que o paciente não gosta. */
const CALC_FLAG_ORDER = ['alergia', 'intolerancia', 'restricao', 'nao gosta'];
const calcFlagRank = (label: string) => {
  const rank = CALC_FLAG_ORDER.indexOf(normalizeName(label));
  return rank < 0 ? CALC_FLAG_ORDER.length : rank;
};

/**
 * Como a Ali diz o que está na ficha: "e a ficha tem alergia a amendoim". Com vários itens do mesmo tipo, fala uma
 * vez só ("o plano cita amendoim e camarão, e a ficha tem alergia a todos eles"), para caber na fala.
 */
function calcFlagPhrase(label: string, terms: string[], patientName: string): string {
  const kind = normalizeName(label);
  const many = terms.length > 1;
  const term = terms[0];
  const who = patientName || 'o paciente';
  // Com vários itens, a frase não depende do gênero deles ("esses itens" serve para camarão e para castanha).
  if (kind === 'alergia') return `e a ficha tem alergia ${many ? 'a esses itens' : `a ${term}`}`;
  if (kind === 'intolerancia') return `e a ficha tem intolerância ${many ? 'a esses itens' : `a ${term}`}`;
  if (kind === 'restricao') {
    if (many) return 'e esses itens estão nas restrições da ficha';
    return /^(sem|zero)\s/i.test(term) ? `e a ficha tem a restrição ${term}` : `e a ficha tem ${term} nas restrições`;
  }
  if (kind === 'nao gosta') return `e a ficha diz que ${who} não gosta ${many ? 'desses itens' : `de ${term}`}`;
  return many ? `e esses itens estão na ficha em ${label}` : `e a ficha tem ${term} em ${label}`;
}

interface CalcAvoid { label: string; term: string; shown: string; words: string[]; key: string }

function calcAvoidList(value: unknown): CalcAvoid[] {
  const list: CalcAvoid[] = [];
  for (const entry of Array.isArray(value) ? value.slice(0, CALC_AVOID_MAX) : []) {
    const e = calcFields(entry);
    const label = cleanText(e.label, 40);
    const term = cleanText(e.term, 80);
    // "sem glúten" na ficha: o que se procura no plano é o glúten.
    const words = normalizeName(term).split(' ').filter(Boolean);
    const negated = words.length > 1 && (words[0] === 'sem' || words[0] === 'zero');
    const core = negated ? words.slice(1) : words;
    if (!label || core.join(' ').length < 2) continue;
    list.push({ label, term, shown: negated ? term.replace(/^\s*\S+\s+/, '') : term, words: core, key: `${normalizeName(label)}|${core.join(' ')}` });
  }
  return list;
}

export interface CalcPlanFlag { label: string; term: string; item: string; day: string; meal: string }

/**
 * Confere um plano pela TACO: total de cada dia, média por dia, proteína por quilo, diferença para a meta e o que
 * bate com a ficha clínica (alergias, intolerâncias, restrições e o que o paciente não gosta). Só apoia a revisão.
 */
export function planCheck(plan: unknown, options: { patientName: string; label: string; weight?: number | null; targetKcal?: number | null; avoid?: { label: string; term: string }[] }): ActionResult {
  const opts = calcFields(options);
  const patientName = cleanText(opts.patientName, 120);
  const rawLabel = cleanText(opts.label, 60) || 'plano';
  const label = rawLabel.charAt(0).toUpperCase() + rawLabel.slice(1);
  const owner = patientName ? `de ${patientName}` : 'do paciente';
  const rawDays = calcFields(plan).days;
  const planDays = (Array.isArray(rawDays) ? rawDays : []).filter((day) => day && typeof day === 'object').slice(0, CALC_PLAN_MAX_DAYS) as Record<string, unknown>[];
  if (!planDays.length) return { ok: false, status: 404, speech: `${label} ${owner} não tem dias com refeições para eu conferir.` };

  const avoid = calcAvoidList(opts.avoid);
  const flags: CalcPlanFlag[] = [];
  const flagKeys = new Set<string>();
  const spokenFlags: CalcAvoid[] = [];
  const days = planDays.map((day, d) => {
    const name = cleanText(day.name, 80) || `Dia ${d + 1}`;
    const meals = (Array.isArray(day.meals) ? day.meals : []).filter((meal) => meal && typeof meal === 'object') as Record<string, unknown>[];
    let items = 0;
    for (const meal of meals) {
      const mealItems = Array.isArray(meal.items) ? meal.items : [];
      items += mealItems.length;
      if (!avoid.length) continue;
      const mealName = cleanText(meal.name, 80) || 'Refeição';
      for (const rawItem of mealItems) {
        const item = cleanText(rawItem, 200);
        const itemWords = normalizeName(item).split(' ').filter(Boolean);
        if (!itemWords.length) continue;
        for (const entry of avoid) {
          const key = `${entry.key}|${itemWords.join(' ')}`;
          if (flagKeys.has(key) || !calcMentions(itemWords, entry.words)) continue;
          flagKeys.add(key);
          if (flags.length < CALC_FLAGS_MAX) flags.push({ label: entry.label, term: entry.term, item, day: name, meal: mealName });
          if (!spokenFlags.some((s) => s.key === entry.key)) spokenFlags.push(entry);
        }
      }
    }
    const totals = dayTotals({ meals });
    return totals
      ? { name, kcal: totals.kcal, protein: totals.protein, carbs: totals.carbs, fat: totals.fat, items: totals.items, counted: totals.counted, incomplete: totals.incomplete }
      : { name, kcal: null, protein: null, carbs: null, fat: null, items, counted: 0, incomplete: items > 0 };
  });

  // Do mais grave ao menos grave, um grupo por tipo; o que não cabe na fala vira "e mais N".
  spokenFlags.sort((a, b) => calcFlagRank(a.label) - calcFlagRank(b.label));
  const groups: { kind: string; entries: CalcAvoid[] }[] = [];
  for (const entry of spokenFlags.slice(0, CALC_FLAGS_SPOKEN)) {
    const kind = normalizeName(entry.label);
    const group = groups.find((g) => g.kind === kind);
    if (group) group.entries.push(entry);
    else groups.push({ kind, entries: [entry] });
  }
  const hidden = spokenFlags.length - CALC_FLAGS_SPOKEN;
  const flagSpeech = groups.map((group, i) => `${i ? 'Também cita' : 'Atenção: o plano cita'} ${joinPt(group.entries.map((e) => e.shown))}, `
    + `${calcFlagPhrase(group.entries[0].label, group.entries.map((e) => e.term), patientName)}.`).join(' ')
    + (hidden > 0 ? ` E mais ${hidden} ${hidden === 1 ? 'ponto da ficha aparece' : 'pontos da ficha aparecem'} no plano.` : '');
  const uncounted = days.reduce((sum, day) => sum + Math.max(0, day.items - day.counted), 0);
  const withTotals = days.filter((day) => day.kcal !== null);
  const base = { days, flags, uncounted };
  if (!withTotals.length) {
    return {
      ok: true,
      speech: `${flagSpeech ? `${flagSpeech} ` : ''}${label} ${owner} ainda não tem itens ligados à tabela TACO, então não consigo calcular calorias nem macros.`
        + (flagSpeech ? ' A conferência da ficha é só um apoio para a sua decisão.' : ''),
      ...base, average: null, proteinPerKg: null, target: null,
    };
  }

  const mean = (key: 'kcal' | 'protein' | 'carbs' | 'fat') => withTotals.reduce((sum, day) => sum + (day[key] as number), 0) / withTotals.length;
  const average = { kcal: Math.round(mean('kcal')), protein: Math.round(mean('protein')), carbs: Math.round(mean('carbs')), fat: Math.round(mean('fat')), days: withTotals.length };
  const weight = calcNumber(opts.weight);
  const proteinPerKg = weight >= 30 && weight <= 300 ? calcRound(mean('protein') / weight, 1) : null;
  const targetKcal = Math.round(calcNumber(opts.targetKcal));
  const target = targetKcal >= 800 && targetKcal <= 6000
    ? { kcal: targetKcal, difference: average.kcal - targetKcal, percent: Math.round(((average.kcal - targetKcal) / targetKcal) * 100) }
    : null;

  const parts: string[] = [];
  if (flagSpeech) parts.push(flagSpeech);
  parts.push(`${label} ${owner}, pela tabela TACO: ${withTotals.length > 1 ? 'em média, ' : ''}cerca de ${calcSpoken(average.kcal)} calorias por dia, `
    + `com ${calcGrams(average.protein)} de proteína, ${calcSpoken(average.carbs)} de carboidrato e ${calcSpoken(average.fat)} de gordura.`);
  if (withTotals.length < days.length) parts.push(`A média considera só ${withTotals.length === 1 ? 'o dia' : `os ${withTotals.length} dias`} com cálculo.`);
  if (proteinPerKg !== null) parts.push(`Isso dá ${calcGrams(proteinPerKg)} de proteína por quilo de peso.`);
  if (target) {
    const gap = Math.abs(target.difference);
    const pct = Math.abs(target.percent);
    parts.push(target.difference === 0
      ? `Bate com a meta de ${calcSpoken(target.kcal)} calorias.`
      : `Fica ${calcSpoken(gap)} calorias ${target.difference > 0 ? 'acima' : 'abaixo'} da meta de ${calcSpoken(target.kcal)}${pct ? `, cerca de ${pct} por cento a ${target.difference > 0 ? 'mais' : 'menos'}` : ''}.`);
  }
  if (uncounted) parts.push(`${uncounted === 1 ? 'Um item não está ligado' : `${uncounted} itens não estão ligados`} à tabela e ${uncounted === 1 ? 'ficou' : 'ficaram'} fora da conta, então o total real pode ser maior.`);
  else if (days.some((day) => day.incomplete)) parts.push('Alguns alimentos estão em reavaliação na TACO e entraram sem parte dos valores.');
  parts.push(CALC_PLAN_NOTE);
  return { ok: true, speech: parts.join(' '), ...base, average, proteinPerKg, target };
}
