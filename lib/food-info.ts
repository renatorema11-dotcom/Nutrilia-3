// "Quantas calorias tem…?" para as duas Alis: acha o alimento na TACO e diz calorias e macros da porção pedida.
// Só leitura e sem banco: a tabela está no próprio app. O texto é para ser falado (números em português, "gramas").
import { foodById, foodCandidates, foodPortion, foodSearchText, searchFoods } from './food-table';
import type { FoodItem, NutrientKey } from './food-table';
import type { TacoValue } from './taco-foods';

export type FoodInfoResult =
  | { ok: true; speech: string; food: { taco: number; name: string; grams: number; kcal: TacoValue; protein: TacoValue; carbs: TacoValue; fat: TacoValue } }
  | { ok: false; status: number; speech: string };

const MAX_FOOD_TEXT = 80;

// O que se costuma querer dizer no Brasil vem primeiro, pela primeira palavra (a TACO, por ordem, poria "azeite de
// dendê" antes do de oliva, "arroz integral" antes do branco e coração de frango antes do peito). Só vale quando esse
// alimento tem todas as palavras ditas: "frango grelhado" vira o peito grelhado, "arroz integral" continua integral.
const FOOD_DEFAULTS: Record<string, number> = {
  arroz: 3, feijao: 561, ovo: 488, ovos: 488, pao: 53, banana: 182, azeite: 260, cafe: 471, batata: 91, mandioca: 129,
  frango: 410, queijo: 461, acucar: 494, maca: 222, mamao: 226,
};
const MAX_INFO_GRAMS = 2000;

const spokenName = (food: FoodItem) => food.name.replace(/\/\s*\d+\s*minutos/gi, '');
const spoken = (value: number) => value.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const infoGrams = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\s*\d+(?:[.,]\d+)?\s*$/.test(value) ? Number(value.trim().replace(',', '.')) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= MAX_INFO_GRAMS ? Math.round(n) : null;
};

/** "2,6 gramas de proteína", "traços de fibra"; sem valor na TACO, a parte fica de fora. */
function nutrientPhrase(value: TacoValue, label: string, unit: string): string {
  if (value === null) return '';
  if (value === 'Tr') return `traços de ${label}`;
  return `${spoken(value)} ${unit} de ${label}`;
}

function joinSpoken(parts: string[]): string {
  const list = parts.filter(Boolean);
  return list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} e ${list[list.length - 1]}`;
}

/**
 * Procura o alimento (busca do app; se nada tiver todas as palavras, o mais parecido) e responde pela porção pedida
 * (100 gramas quando ninguém disse a quantidade). Cita até duas outras opções para a pessoa corrigir se for outro.
 */
export function foodInfo(rawFood: unknown, rawGrams?: unknown): FoodInfoResult {
  const text = typeof rawFood === 'string' ? rawFood.replace(/\s+/g, ' ').trim() : '';
  if (text.length < 2 || text.length > MAX_FOOD_TEXT) return { ok: false, status: 422, speech: 'Qual alimento você quer consultar?' };
  const emptyGrams = rawGrams === undefined || rawGrams === null || rawGrams === '';
  const grams = emptyGrams ? 100 : infoGrams(rawGrams);
  if (grams === null) return { ok: false, status: 422, speech: 'Diga a quantidade em gramas, entre 1 e 2000.' };

  const searched = searchFoods(text, { limit: 100 });
  const preferred = foodById(FOOD_DEFAULTS[foodSearchText(text).split(' ')[0]]);
  const exact = (preferred && searched.some((other) => other.id === preferred.id)
    ? [preferred, ...searched.filter((other) => other.id !== preferred.id)]
    : searched).slice(0, 3);
  const found: FoodItem[] = exact.length ? exact : foodCandidates(text, 3);
  if (!found.length) {
    return { ok: false, status: 404, speech: `Não achei ${text} na tabela TACO. Ela traz alimentos in natura e preparações básicas; produtos de marca e suplementos não estão nela.` };
  }
  const [food, ...others] = found;
  const portion = foodPortion(food, grams);
  const value = (key: NutrientKey) => portion[key];
  const intro = exact.length ? 'Pela tabela TACO' : `O mais parecido que achei na tabela TACO foi ${spokenName(food)}. Pela tabela`;
  const alternatives = others.length ? ` Se for outro, a tabela também tem ${joinSpoken(others.map(spokenName))}.` : '';

  if (food.underReview && typeof portion.kcal !== 'number') {
    return {
      ok: true,
      speech: `${intro}, ${spokenName(food)} está com os valores em reavaliação pela própria TACO, então ela não traz as calorias dele agora.${alternatives}`,
      food: { taco: food.id, name: food.name, grams, kcal: null, protein: null, carbs: null, fat: null },
    };
  }
  const kcal = typeof portion.kcal === 'number' ? `cerca de ${spoken(portion.kcal)} calorias` : '';
  const macros = joinSpoken([
    kcal,
    nutrientPhrase(value('protein'), 'proteína', 'gramas'),
    nutrientPhrase(value('carbs'), 'carboidrato', 'gramas'),
    nutrientPhrase(value('fat'), 'gordura', 'gramas'),
  ]);
  const fiber = typeof portion.fiber === 'number' && portion.fiber > 0 ? ` Tem também ${spoken(portion.fiber)} gramas de fibra.` : '';
  return {
    ok: true,
    speech: `${intro}, ${spoken(grams)} gramas de ${spokenName(food)} têm ${macros}.${fiber}${alternatives}`,
    food: { taco: food.id, name: food.name, grams, kcal: portion.kcal, protein: portion.protein, carbs: portion.carbs, fat: portion.fat },
  };
}
