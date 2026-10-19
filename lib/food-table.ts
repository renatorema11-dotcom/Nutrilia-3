// Tabela de alimentos (TACO): busca sem acento e contas por porção. Sem banco e sem segredos: a mesma lógica
// serve para a tela da nutricionista e, depois, para os planos e a Ali no servidor.
// Valor null = a TACO não traz (não analisado, não se aplica ou em reavaliação); 'Tr' = traço (quantidade mínima).
import { TACO_CATEGORIES, TACO_FIELDS, TACO_ROWS, TACO_UNDER_REVIEW } from './taco-foods';
import type { TacoValue } from './taco-foods';

export type NutrientKey = (typeof TACO_FIELDS)[number];
export type NutrientGroup = 'Principais' | 'Gorduras' | 'Minerais' | 'Vitaminas';

export interface FoodItem {
  id: number;
  name: string;
  category: string;
  /** A própria TACO marca este alimento com análises sendo reavaliadas: os valores que faltam não são zero. */
  underReview: boolean;
  values: Record<NutrientKey, TacoValue>;
}

export const FOOD_NUTRIENTS: { key: NutrientKey; label: string; unit: string; group: NutrientGroup }[] = [
  { key: 'kcal', label: 'Energia', unit: 'kcal', group: 'Principais' },
  { key: 'protein', label: 'Proteína', unit: 'g', group: 'Principais' },
  { key: 'carbs', label: 'Carboidrato', unit: 'g', group: 'Principais' },
  { key: 'fat', label: 'Gorduras totais', unit: 'g', group: 'Principais' },
  { key: 'fiber', label: 'Fibra alimentar', unit: 'g', group: 'Principais' },
  { key: 'saturated', label: 'Saturadas', unit: 'g', group: 'Gorduras' },
  { key: 'monounsaturated', label: 'Monoinsaturadas', unit: 'g', group: 'Gorduras' },
  { key: 'polyunsaturated', label: 'Poli-insaturadas', unit: 'g', group: 'Gorduras' },
  { key: 'cholesterol', label: 'Colesterol', unit: 'mg', group: 'Gorduras' },
  { key: 'calcium', label: 'Cálcio', unit: 'mg', group: 'Minerais' },
  { key: 'iron', label: 'Ferro', unit: 'mg', group: 'Minerais' },
  { key: 'sodium', label: 'Sódio', unit: 'mg', group: 'Minerais' },
  { key: 'potassium', label: 'Potássio', unit: 'mg', group: 'Minerais' },
  { key: 'magnesium', label: 'Magnésio', unit: 'mg', group: 'Minerais' },
  { key: 'phosphorus', label: 'Fósforo', unit: 'mg', group: 'Minerais' },
  { key: 'zinc', label: 'Zinco', unit: 'mg', group: 'Minerais' },
  { key: 'copper', label: 'Cobre', unit: 'mg', group: 'Minerais' },
  { key: 'manganese', label: 'Manganês', unit: 'mg', group: 'Minerais' },
  { key: 'retinol', label: 'Retinol (vitamina A)', unit: 'mcg', group: 'Vitaminas' },
  { key: 'thiamine', label: 'Tiamina (B1)', unit: 'mg', group: 'Vitaminas' },
  { key: 'riboflavin', label: 'Riboflavina (B2)', unit: 'mg', group: 'Vitaminas' },
  { key: 'pyridoxine', label: 'Piridoxina (B6)', unit: 'mg', group: 'Vitaminas' },
  { key: 'niacin', label: 'Niacina (B3)', unit: 'mg', group: 'Vitaminas' },
  { key: 'vitaminC', label: 'Vitamina C', unit: 'mg', group: 'Vitaminas' },
];

/** Minúsculas, sem acento e sem pontuação: "Feijão, preto" vira "feijao preto". */
export function foodSearchText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Raiz da palavra para a busca: tira o plural ("ovos" acha "ovo", "pães" acha "pão", "limões" acha "limão") e iguala
 * masculino e feminino ("moída" acha "moído", "crua" acha "cru", "cozida" acha "cozido").
 */
function foodWordRoot(word: string): string {
  let root = word;
  if (root.length > 3) {
    if (root.endsWith('oes') || root.endsWith('aes')) root = root.slice(0, -3) + 'ao';
    else if (root.endsWith('ais')) root = root.slice(0, -3) + 'al';
    else if (root.endsWith('eis')) root = root.slice(0, -3) + 'el';
    // "franceses" e "francês" precisam cair na mesma raiz: tira o "es" e depois o "s" como nas outras palavras.
    else if (root.length > 5 && /[szr]es$/.test(root)) root = root.slice(0, -2);
    if (root.length > 3 && root.endsWith('s')) root = root.slice(0, -1);
  }
  if (root.length >= 4 && (root.endsWith('a') || root.endsWith('o'))) root = root.slice(0, -1);
  return root;
}

/** Palavras de ligação não contam na busca ("peito de frango" acha "Frango, peito"); "com" e "sem" contam. */
const FOOD_STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'em', 'na', 'no', 'ao', 'tipo']);

const foodWords = (text: string) => foodSearchText(text).split(' ').filter((word) => word && !FOOD_STOPWORDS.has(word)).map(foodWordRoot);

interface IndexedFood { food: FoodItem; words: string[] }
let foodIndex: IndexedFood[] | null = null;

function indexedFoods(): IndexedFood[] {
  if (!foodIndex) {
    const review = new Set(TACO_UNDER_REVIEW);
    foodIndex = TACO_ROWS.map(([id, name, category, ...raw]) => {
      const values = Object.fromEntries(TACO_FIELDS.map((key, i) => [key, raw[i] ?? null])) as Record<NutrientKey, TacoValue>;
      const food: FoodItem = { id, name, category: TACO_CATEGORIES[category] || '', underReview: review.has(id), values };
      return { food, words: foodWords(name) };
    });
  }
  return foodIndex;
}

export function allFoods(): FoodItem[] {
  return indexedFoods().map((entry) => entry.food);
}

export function foodById(id: unknown): FoodItem | null {
  return typeof id === 'number' ? indexedFoods().find((entry) => entry.food.id === id)?.food || null : null;
}

/**
 * Busca por nome: todas as palavras digitadas precisam aparecer (inteiras, no começo de uma palavra ou dentro dela).
 * Palavra inteira vale mais que pedaço e o nome que começa pela primeira palavra digitada sobe. Entre empates vale a
 * ordem da própria TACO, que lista primeiro o alimento básico. Um número busca o alimento pelo número da TACO.
 */
export function searchFoods(query: string, options: { category?: string; limit?: number } = {}): FoodItem[] {
  const limit = Math.max(1, Math.min(options.limit ?? 30, 100));
  const pool = indexedFoods().filter((entry) => !options.category || entry.food.category === options.category);
  const trimmed = query.trim();
  if (/^\d{1,3}$/.test(trimmed)) return pool.filter((entry) => entry.food.id === Number(trimmed)).map((entry) => entry.food);
  const terms = foodWords(trimmed).slice(0, 8);
  if (!terms.length) return options.category ? pool.map((entry) => entry.food).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).slice(0, limit) : [];
  const scored: { food: FoodItem; score: number }[] = [];
  for (const entry of pool) {
    let score = 0;
    let all = true;
    for (const term of terms) {
      let best = 0;
      for (const word of entry.words) {
        if (word === term) best = Math.max(best, 3);
        else if (word.startsWith(term)) best = Math.max(best, 2);
        else if (term.length >= 3 && word.includes(term)) best = Math.max(best, 1);
      }
      if (!best) { all = false; break; }
      score += best;
    }
    if (!all) continue;
    if (entry.words[0] === terms[0] || entry.words[0].startsWith(terms[0])) score += 2;
    scored.push({ food: entry.food, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.food.id - b.food.id)
    .slice(0, limit)
    .map((entry) => entry.food);
}

const foodDecimals = (key: NutrientKey, value: number) => {
  if (key === 'kcal' || key === 'retinol') return 0;
  if (['protein', 'carbs', 'fat', 'fiber', 'saturated', 'monounsaturated', 'polyunsaturated'].includes(key)) return 1;
  return value >= 10 ? 0 : value >= 1 ? 1 : 2;
};

/** Valor para a porção em gramas (a TACO é por 100 g). Traço continua traço; o que falta continua faltando. */
export function portionValue(value: TacoValue, grams: number, key: NutrientKey): TacoValue {
  if (value === null || value === 'Tr') return value;
  const scaled = (value * grams) / 100;
  const d = foodDecimals(key, scaled);
  return Math.round(scaled * 10 ** d) / 10 ** d;
}

export function foodPortion(food: FoodItem, grams: number): Record<NutrientKey, TacoValue> {
  return Object.fromEntries(TACO_FIELDS.map((key) => [key, portionValue(food.values[key], grams, key)])) as Record<NutrientKey, TacoValue>;
}

/** Texto para a tela: "1,5 g", "traços" ou "—" (a TACO não traz). */
export function formatNutrient(value: TacoValue, unit: string): string {
  if (value === null) return '—';
  if (value === 'Tr') return 'traços';
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${unit}`;
}
