// Ferramentas da tabela TACO para a Ali da nutricionista: todos os nutrientes de um alimento, comparação entre dois
// ou três alimentos e os alimentos com mais de um nutriente. Só leitura e sem banco: a tabela está no próprio app.
// O texto é para ser falado: números em português e unidades por extenso ("miligramas").
import { FOOD_NUTRIENTS, allFoods, foodPortion } from './food-table';
import type { FoodItem, NutrientGroup, NutrientKey } from './food-table';
import { resolveFood } from './food-info';
import { cleanText, joinPt, normalizeName } from './ali-settings';
import type { ActionResult } from './google-workspace';
import type { TacoValue } from './taco-foods';

const FT_MAX_TEXT = 80;
const FT_MAX_GRAMS = 2000;
/** Até quantas letras a lista falada pode ter; o resto vira "e mais N". */
const FT_SPOKEN_BUDGET = 430;
const FT_NOT_IN_TACO = 'Ela traz alimentos in natura e preparações básicas; produtos de marca e suplementos não estão nela.';

/** Nome falado de cada nutriente (sem parênteses nem siglas soltas). */
const FT_SPOKEN: Record<NutrientKey, string> = {
  kcal: 'calorias', protein: 'proteína', carbs: 'carboidrato', fat: 'gordura', fiber: 'fibra',
  saturated: 'gordura saturada', monounsaturated: 'gordura monoinsaturada', polyunsaturated: 'gordura poli-insaturada', cholesterol: 'colesterol',
  calcium: 'cálcio', iron: 'ferro', sodium: 'sódio', potassium: 'potássio', magnesium: 'magnésio', phosphorus: 'fósforo', zinc: 'zinco',
  copper: 'cobre', manganese: 'manganês', retinol: 'retinol', thiamine: 'vitamina B1', riboflavin: 'vitamina B2', pyridoxine: 'vitamina B6',
  niacin: 'vitamina B3', vitaminC: 'vitamina C',
};
const FT_UNITS: Record<string, [string, string]> = { kcal: ['caloria', 'calorias'], g: ['grama', 'gramas'], mg: ['miligrama', 'miligramas'], mcg: ['micrograma', 'microgramas'] };

/** Jeitos de pedir cada nutriente, já sem acento (o nome da tabela e a chave também valem). */
const FT_NUTRIENT_ALIASES: Record<NutrientKey, string[]> = {
  kcal: ['caloria', 'calorias', 'energia', 'valor energetico', 'quilocalorias'],
  protein: ['proteina', 'proteinas'],
  carbs: ['carboidrato', 'carboidratos', 'carbo', 'carbs', 'glicidios'],
  fat: ['gordura', 'gorduras', 'gordura total', 'lipidios', 'lipideos'],
  fiber: ['fibra', 'fibras', 'fibras alimentares'],
  saturated: ['gordura saturada', 'gorduras saturadas', 'saturada'],
  monounsaturated: ['gordura monoinsaturada', 'gorduras monoinsaturadas', 'monoinsaturada'],
  polyunsaturated: ['gordura poli insaturada', 'gorduras poli insaturadas', 'poli insaturada', 'poliinsaturada', 'poliinsaturadas', 'gordura poliinsaturada', 'gorduras poliinsaturadas'],
  cholesterol: ['colesterol'],
  calcium: ['calcio'], iron: ['ferro'], sodium: ['sodio', 'sal'], potassium: ['potassio'], magnesium: ['magnesio'],
  phosphorus: ['fosforo'], zinc: ['zinco'], copper: ['cobre'], manganese: ['manganes'],
  retinol: ['retinol', 'vitamina a'], thiamine: ['tiamina', 'vitamina b1', 'b1'], riboflavin: ['riboflavina', 'vitamina b2', 'b2'],
  pyridoxine: ['piridoxina', 'vitamina b6', 'b6'], niacin: ['niacina', 'vitamina b3', 'b3'], vitaminC: ['vitamina c', 'acido ascorbico'],
};

let ftNutrientIndex: Map<string, NutrientKey> | null = null;

function ftNutrientKey(value: unknown): NutrientKey | null {
  if (!ftNutrientIndex) {
    ftNutrientIndex = new Map();
    for (const n of FOOD_NUTRIENTS) {
      for (const alias of [n.key, n.label, FT_SPOKEN[n.key], ...FT_NUTRIENT_ALIASES[n.key]]) ftNutrientIndex.set(normalizeName(alias), n.key);
    }
  }
  const text = typeof value === 'string' && value.length <= 60 ? normalizeName(value) : '';
  return ftNutrientIndex.get(text) ?? ftNutrientIndex.get(text.replace(/^(o|a|os|as|de|do|da) /, '')) ?? null;
}

type FtGroup = 'principais' | 'gorduras' | 'minerais' | 'vitaminas' | 'tudo';
const FT_GROUP_ALIASES = new Map<string, FtGroup>([
  ['principais', 'principais'], ['principal', 'principais'], ['macros', 'principais'], ['macronutrientes', 'principais'], ['basico', 'principais'], ['basicos', 'principais'],
  ['gorduras', 'gorduras'], ['gordura', 'gorduras'], ['lipidios', 'gorduras'],
  ['minerais', 'minerais'], ['mineral', 'minerais'], ['sais minerais', 'minerais'],
  ['vitaminas', 'vitaminas'], ['vitamina', 'vitaminas'],
  ['tudo', 'tudo'], ['todos', 'tudo'], ['todas', 'tudo'], ['completo', 'tudo'], ['completa', 'tudo'], ['todos os nutrientes', 'tudo'],
]);
const FT_GROUP_TABLE: Record<Exclude<FtGroup, 'tudo'>, NutrientGroup> = { principais: 'Principais', gorduras: 'Gorduras', minerais: 'Minerais', vitaminas: 'Vitaminas' };
const FT_GROUP_MISSING: Record<FtGroup, string> = { principais: 'esses valores', gorduras: 'o detalhe das gorduras', minerais: 'os minerais', vitaminas: 'as vitaminas', tudo: 'esses valores' };

/** Categorias ditas de outro jeito ("peixe" é "Pescados e frutos do mar"). */
const FT_CATEGORY_ALIASES: Record<string, string> = {
  peixe: 'pescados', peixes: 'pescados', legume: 'verduras', legumes: 'verduras', hortalica: 'verduras', hortalicas: 'verduras',
  laticinio: 'leite', laticinios: 'leite', castanha: 'nozes', castanhas: 'nozes', semente: 'nozes', sementes: 'nozes', doce: 'acucarados', doces: 'acucarados',
};

const ftSpokenName = (food: FoodItem) => food.name.replace(/\/\s*\d+\s*minutos/gi, '');
const ftSpoken = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: value < 1 ? 2 : 1 });
const ftUnit = (unit: string, value: number) => (FT_UNITS[unit] ? FT_UNITS[unit][value === 1 ? 0 : 1] : unit);
// Sem caracteres de controle nem chaves: o nome dito volta na fala ("Não achei …").
const ftFoodText = (value: unknown) => cleanText(value, 200).replace(/\s+/g, ' ').trim();
const ftAsk = (speech: string): ActionResult => ({ ok: false, status: 422, speech });
const ftFields = (input: unknown): Record<string, unknown> => (input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {});

/** Gramas da porção ("150", "150 g", "1.500 gramas"): 100 quando ninguém disse; null quando está fora de 1 a 2000. */
function ftGrams(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return 100;
  const text = typeof value === 'string' && value.length <= 30 ? value.trim().replace(/\s*(g|gramas?)$/i, '') : '';
  const n = typeof value === 'number' ? value
    : /^\d{1,3}(\.\d{3})+$/.test(text) ? Number(text.replace(/\./g, ''))
      : /^\d+([.,]\d+)?$/.test(text) ? Number(text.replace(',', '.')) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= FT_MAX_GRAMS ? Math.round(n) : null;
}

/** "26 miligramas de cálcio", "traços de ferro", "sem colesterol", "cerca de 98 calorias"; sem valor na TACO, fica de fora. */
function ftPhrase(key: NutrientKey, value: TacoValue, unit: string): string {
  if (value === null) return '';
  if (value === 'Tr') return `traços de ${FT_SPOKEN[key]}`;
  if (value === 0) return `sem ${FT_SPOKEN[key]}`;
  if (key === 'kcal') return `cerca de ${ftSpoken(value)} ${ftUnit('kcal', value)}`;
  return `${ftSpoken(value)} ${ftUnit(unit, value)} de ${FT_SPOKEN[key]}`;
}

/** Os primeiros itens que cabem na fala e quantos ficaram de fora. */
function ftFit(parts: string[], budget = FT_SPOKEN_BUDGET): { shown: string[]; rest: number } {
  const shown: string[] = [];
  let size = 0;
  for (const part of parts) {
    if (shown.length && size + part.length > budget) break;
    shown.push(part);
    size += part.length + 2;
  }
  return { shown, rest: parts.length - shown.length };
}

/** Todos os nutrientes da porção; a fala diz o grupo pedido (os principais, se ela não disser). */
export function foodNutrients(input: { food?: unknown; grams?: unknown; group?: unknown }): ActionResult {
  const raw = ftFields(input);
  const text = ftFoodText(raw.food);
  if (text.length < 2 || text.length > FT_MAX_TEXT) return ftAsk('Qual alimento você quer consultar?');
  const grams = ftGrams(raw.grams);
  if (grams === null) return ftAsk('Diga a quantidade em gramas, entre 1 e 2000.');
  const groupText = typeof raw.group === 'string' ? normalizeName(raw.group) : '';
  const group = groupText ? FT_GROUP_ALIASES.get(groupText) : 'principais';
  if (!group) return ftAsk('Posso dizer os principais, as gorduras, os minerais, as vitaminas ou tudo. Qual você quer?');
  const found = resolveFood(text);
  if (!found) return { ok: false, status: 404, speech: `Não achei ${text} na tabela TACO. ${FT_NOT_IN_TACO}` };

  const { food, exact, others } = found;
  const portion = foodPortion(food, grams);
  const nutrients = FOOD_NUTRIENTS.map((n) => ({ key: n.key, label: n.label, unit: n.unit, value: portion[n.key] }));
  // Nas gorduras, a gordura total vem antes do detalhe.
  const chosen = FOOD_NUTRIENTS.filter((n) => group === 'tudo' || n.group === FT_GROUP_TABLE[group] || (group === 'gorduras' && n.key === 'fat'))
    .map((n) => ({ key: n.key, unit: n.unit, value: portion[n.key] }));
  const phrases = chosen.map((n) => ftPhrase(n.key, n.value, n.unit)).filter(Boolean);
  const name = ftSpokenName(food);
  const intro = exact ? 'Pela tabela TACO' : `O mais parecido que achei na tabela TACO foi ${name}. Pela tabela`;
  const alternatives = others.length ? ` Se for outro, a tabela também tem ${joinPt(others.map(ftSpokenName))}.` : '';
  const review = food.underReview && chosen.some((n) => n.value === null) ? ' Alguns valores dele estão em reavaliação pela própria TACO.' : '';
  const extra = { food: { taco: food.id, name: food.name, grams }, group, nutrients };
  if (!phrases.length) {
    const lead = exact ? 'A tabela TACO' : `O mais parecido que achei na tabela TACO foi ${name}. A tabela`;
    return { ok: true, speech: `${lead} não traz ${FT_GROUP_MISSING[group]} para ${name}.${review}${alternatives}`, ...extra };
  }
  const { shown, rest } = ftFit(phrases);
  const list = rest ? `${shown.join(', ')} e mais ${rest} ${rest === 1 ? 'valor' : 'valores'}` : joinPt(shown);
  const hint = rest ? ' Se quiser, peça só os minerais, as vitaminas ou as gorduras.' : '';
  return { ok: true, speech: `${intro}, ${ftSpoken(grams)} gramas de ${name} têm ${list}.${hint}${review}${alternatives}`, ...extra };
}

/** Nomes para comparar: lista ou uma frase só ("arroz e feijão", "ovo x frango", "tapioca ou pão"). */
function ftFoodList(value: unknown): string[] {
  const list = Array.isArray(value) ? value.slice(0, 5) : [value];
  // Lista com algo que não é texto: melhor perguntar de novo do que comparar só uma parte.
  if (list.some((entry) => typeof entry !== 'string')) return [];
  const texts = list.length === 1 ? (list[0] as string).split(/\s*[,;]\s*|\s+(?:e|x|vs\.?|versus|ou)\s+/i) : list;
  return texts.map(ftFoodText).filter(Boolean);
}

/** Valor para comparar: traço conta como zero; o que a TACO não traz fica de fora da comparação. */
const ftComparable = (value: TacoValue): number | null => (value === 'Tr' ? 0 : value);

/** Compara a mesma porção de dois ou três alimentos: calorias, proteína, carboidrato, gordura e fibra. */
export function compareFoods(input: { foods?: unknown; grams?: unknown }): ActionResult {
  const raw = ftFields(input);
  const names = ftFoodList(raw.foods);
  if (names.length < 2 || names.length > 3) return ftAsk('Diga dois ou três alimentos para eu comparar, por exemplo arroz e feijão.');
  if (names.some((name) => name.length < 2 || name.length > FT_MAX_TEXT)) return ftAsk('Não entendi um dos alimentos. Quais você quer comparar?');
  const grams = ftGrams(raw.grams);
  if (grams === null) return ftAsk('Diga a quantidade em gramas, entre 1 e 2000.');
  const resolved = names.map((name) => ({ name, found: resolveFood(name) }));
  const missing = resolved.filter((entry) => !entry.found).map((entry) => entry.name);
  if (missing.length) return { ok: false, status: 404, speech: `Não achei ${joinPt(missing)} na tabela TACO. ${FT_NOT_IN_TACO}` };
  const foods = resolved.map((entry) => (entry.found as NonNullable<typeof entry.found>).food);
  const repeated = foods.find((food, i) => foods.findIndex((other) => other.id === food.id) !== i);
  if (repeated) {
    const same = joinPt(resolved.filter((entry) => entry.found?.food.id === repeated.id).map((entry) => entry.name));
    return ftAsk(`${same.charAt(0).toUpperCase()}${same.slice(1)} caíram no mesmo alimento da tabela, ${ftSpokenName(repeated)}. Pode dizer de outro jeito?`);
  }

  const rows = foods.map((food) => {
    const p = foodPortion(food, grams);
    return { taco: food.id, name: food.name, kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat, fiber: p.fiber };
  });
  const describe = (row: (typeof rows)[number], i: number) => {
    const parts: string[] = [];
    if (typeof row.kcal === 'number') parts.push(`cerca de ${ftSpoken(row.kcal)} ${ftUnit('kcal', row.kcal)}`);
    let unitSaid = false;
    for (const key of ['protein', 'carbs', 'fat', 'fiber'] as const) {
      const value = row[key];
      if (value === null) continue;
      if (value === 'Tr' || value === 0) { parts.push(`${value === 0 ? 'sem' : 'traços de'} ${FT_SPOKEN[key]}`); continue; }
      parts.push(`${ftSpoken(value)} ${unitSaid ? '' : `${ftUnit('g', value)} `}de ${FT_SPOKEN[key]}`);
      unitSaid = true;
    }
    return `${ftSpokenName(foods[i])} tem ${parts.length ? joinPt(parts) : 'os valores em reavaliação pela própria TACO'}`;
  };
  // Quem ganha em cada ponto: null quando não dá para comparar (a TACO não traz), [] quando todos empatam.
  const best = (key: 'protein' | 'kcal', pick: (values: number[]) => number): string[] | null => {
    const known = rows.map((row, i) => ({ i, value: ftComparable(row[key]) })).filter((entry): entry is { i: number; value: number } => entry.value !== null);
    if (known.length < 2) return null;
    const target = pick(known.map((entry) => entry.value));
    const winners = known.filter((entry) => entry.value === target).map((entry) => ftSpokenName(foods[entry.i]));
    return winners.length === known.length ? [] : winners;
  };
  const moreProtein = best('protein', (values) => Math.max(...values));
  const fewerKcal = best('kcal', (values) => Math.min(...values));
  const verb = (names: string[]) => (names.length > 1 ? 'têm' : 'tem');
  const sameWinner = moreProtein?.length === 1 && fewerKcal?.length === 1 && moreProtein[0] === fewerKcal[0];
  const verdict = sameWinner
    ? `${(moreProtein as string[])[0]} tem mais proteína e também menos calorias.`
    : [
      !moreProtein ? '' : moreProtein.length ? `${joinPt(moreProtein)} ${verb(moreProtein)} mais proteína.` : 'A proteína é a mesma.',
      !fewerKcal ? '' : fewerKcal.length ? `${joinPt(fewerKcal)} ${verb(fewerKcal)} menos calorias.` : 'As calorias são as mesmas.',
    ].filter(Boolean).join(' ');
  return {
    ok: true,
    speech: `Pela tabela TACO, em ${ftSpoken(grams)} gramas: ${rows.map(describe).join('. ')}.${verdict ? ` ${verdict}` : ''}`,
    grams, foods: rows,
  };
}

/** Os alimentos da TACO com mais de um nutriente em 100 gramas, se ela quiser só de uma categoria. */
export function foodSources(input: { nutrient?: unknown; category?: unknown; limit?: unknown }): ActionResult {
  const raw = ftFields(input);
  const key = ftNutrientKey(raw.nutrient);
  if (!key) return ftAsk('Não conheço esse nutriente na tabela TACO. Posso buscar, por exemplo, ferro, cálcio, proteína, fibra, potássio, magnésio, zinco, sódio ou vitamina C.');
  const nutrient = FOOD_NUTRIENTS.find((n) => n.key === key) as (typeof FOOD_NUTRIENTS)[number];
  const limitNumber = typeof raw.limit === 'number' ? raw.limit : typeof raw.limit === 'string' && /^\s*\d{1,3}\s*$/.test(raw.limit) ? Number(raw.limit) : NaN;
  const limit = Number.isFinite(limitNumber) ? Math.max(3, Math.min(10, Math.round(limitNumber))) : 5;
  const categoryText = typeof raw.category === 'string' && raw.category.length <= 60 ? normalizeName(raw.category) : '';
  const categoryWord = Object.hasOwn(FT_CATEGORY_ALIASES, categoryText) ? FT_CATEGORY_ALIASES[categoryText] : categoryText;
  const pool = allFoods().filter((food) => !categoryWord || normalizeName(food.category).includes(categoryWord));
  // Pedaço curto demais ("e", "de") bateria com quase toda categoria: melhor dizer quais existem.
  if (categoryWord && (categoryWord.length < 3 || !pool.length)) {
    const categories = [...new Set(allFoods().map((food) => food.category).filter(Boolean))];
    return ftAsk(`Não achei essa categoria na tabela TACO. As categorias são: ${joinPt(categories.map((c) => c.toLowerCase()))}.`);
  }
  // Só números: traço e "não analisado" não entram na lista; alimento em reavaliação sem o valor também não.
  const ranked = pool
    .filter((food) => typeof food.values[key] === 'number')
    .sort((a, b) => (b.values[key] as number) - (a.values[key] as number) || a.id - b.id)
    .slice(0, limit);
  const label = FT_SPOKEN[key];
  const where = categoryWord ? ` entre ${joinPt([...new Set(pool.map((food) => food.category.toLowerCase()))].slice(0, 3))},` : '';
  const extra = { nutrient: { key, label: nutrient.label, unit: nutrient.unit }, foods: ranked.map((food) => ({ taco: food.id, name: food.name, category: food.category, value: food.values[key] as number })) };
  if (!ranked.length) return { ok: false, status: 404, speech: `Na tabela TACO, nenhum alimento${where ? ` dessa categoria` : ''} tem o valor de ${label}.` };
  const parts = ranked.map((food) => {
    const value = food.values[key] as number;
    return `${ftSpokenName(food)}, com ${ftSpoken(value)} ${ftUnit(nutrient.unit, value)}`;
  });
  // Os nomes da TACO já têm vírgulas ("Gergelim, semente"): entre um alimento e outro, ponto e vírgula.
  const { shown, rest } = ftFit(parts);
  const list = rest ? `${shown.join('; ')} e mais ${rest}` : shown.length > 1 ? `${shown.slice(0, -1).join('; ')} e ${shown[shown.length - 1]}` : shown[0];
  return { ok: true, speech: `Pela tabela TACO,${where} os alimentos com mais ${label} em 100 gramas são: ${list}.`, ...extra };
}
