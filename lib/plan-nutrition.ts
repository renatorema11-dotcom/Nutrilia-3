// Calorias e macros do plano alimentar pela TACO: cada item do plano pode ter o alimento da tabela e o peso em gramas
// (meal.foods, na mesma ordem de meal.items). Sem banco e sem segredos: serve para a tela e para a Ali no servidor.
// É uma estimativa: o peso vem da IA e a nutricionista confere antes de aprovar.
import { foodById, foodPortion } from './food-table';

export interface PlanFood { taco: number; grams: number }

export interface PlanTotals {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Itens do trecho (refeição ou dia) e quantos entraram na conta. */
  items: number;
  counted: number;
  /** Algum item sem alimento da TACO ou com valor que a TACO não traz: o total fica abaixo do real. */
  incomplete: boolean;
}

export interface PlanItemNutrition { item: string; name: string; grams: number; kcal: number | null; protein: number | null; carbs: number | null; fat: number | null }

const MAX_ITEM_GRAMS = 2000;

/** Alimento e peso de cada item da refeição, conferidos (o que não bate com a TACO vira null). */
export function planFoodsOf(meal: unknown): (PlanFood | null)[] {
  const m = meal && typeof meal === 'object' ? meal as { items?: unknown; foods?: unknown } : {};
  const items = Array.isArray(m.items) ? m.items : [];
  const foods = Array.isArray(m.foods) ? m.foods : [];
  return items.map((_, i) => {
    const raw = foods[i] as { taco?: unknown; grams?: unknown } | null | undefined;
    if (!raw || typeof raw !== 'object') return null;
    const grams = raw.grams;
    if (typeof grams !== 'number' || !Number.isFinite(grams) || grams <= 0 || grams > MAX_ITEM_GRAMS) return null;
    return foodById(raw.taco) ? { taco: raw.taco as number, grams } : null;
  });
}

// Na conta, traço vale zero e "não se aplica" (sem valor na TACO, como carboidrato no azeite) também. Só fica faltando
// o valor dos alimentos que a própria TACO marca como em reavaliação.
const tacoAmount = (value: number | 'Tr' | null, underReview: boolean) => (value === 'Tr' ? 0 : value === null ? (underReview ? null : 0) : value);

/** Contas item a item, para a nutricionista ver de onde saiu o total. */
export function planItemsNutrition(meal: unknown): (PlanItemNutrition | null)[] {
  const items = Array.isArray((meal as { items?: unknown })?.items) ? (meal as { items: unknown[] }).items : [];
  return planFoodsOf(meal).map((food, i) => {
    const item = typeof items[i] === 'string' ? items[i] as string : '';
    const found = food && foodById(food.taco);
    if (!food || !found) return null;
    const portion = foodPortion(found, food.grams);
    return {
      item, name: found.name, grams: food.grams,
      kcal: tacoAmount(portion.kcal, found.underReview), protein: tacoAmount(portion.protein, found.underReview),
      carbs: tacoAmount(portion.carbs, found.underReview), fat: tacoAmount(portion.fat, found.underReview),
    };
  });
}

function sumTotals(parts: { totals: PlanTotals | null; items: number }[]): PlanTotals | null {
  const counted = parts.filter((part) => part.totals);
  if (!counted.length) return null;
  const total: PlanTotals = { kcal: 0, protein: 0, carbs: 0, fat: 0, items: 0, counted: 0, incomplete: false };
  for (const part of parts) {
    total.items += part.items;
    if (!part.totals) { if (part.items) total.incomplete = true; continue; }
    total.kcal += part.totals.kcal;
    total.protein += part.totals.protein;
    total.carbs += part.totals.carbs;
    total.fat += part.totals.fat;
    total.counted += part.totals.counted;
    if (part.totals.incomplete) total.incomplete = true;
  }
  return roundTotals(total);
}

const roundTotals = (t: PlanTotals): PlanTotals => ({
  ...t, kcal: Math.round(t.kcal), protein: Math.round(t.protein), carbs: Math.round(t.carbs), fat: Math.round(t.fat),
});

/** Total da refeição. null quando nenhum item tem alimento da TACO (plano antigo ou sem cálculo). */
export function mealTotals(meal: unknown): PlanTotals | null {
  const rows = planItemsNutrition(meal);
  if (!rows.some(Boolean)) return null;
  const total: PlanTotals = { kcal: 0, protein: 0, carbs: 0, fat: 0, items: rows.length, counted: 0, incomplete: false };
  for (const row of rows) {
    if (!row) { total.incomplete = true; continue; }
    total.counted++;
    for (const key of ['kcal', 'protein', 'carbs', 'fat'] as const) {
      if (row[key] === null) total.incomplete = true;
      else total[key] += row[key] as number;
    }
  }
  return roundTotals(total);
}

/** Total do dia (soma das refeições). null quando nenhuma refeição tem cálculo. */
export function dayTotals(day: unknown): PlanTotals | null {
  const meals = Array.isArray((day as { meals?: unknown })?.meals) ? (day as { meals: unknown[] }).meals : [];
  return sumTotals(meals.map((meal) => ({
    totals: mealTotals(meal),
    items: Array.isArray((meal as { items?: unknown })?.items) ? ((meal as { items: unknown[] }).items).length : 0,
  })));
}
