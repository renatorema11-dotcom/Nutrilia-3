// Foto do prato pela TACO: cada item com peso estimado é ligado a um alimento da tabela e ganha calorias e macros.
// Fica separado de lib/meal-photo.ts para a tabela não ir junto para o navegador. Somente no servidor.
import { foodById, foodPortion } from './food-table';
import type { MealPhotoAnalysis, MealPhotoItem } from './meal-photo';
import { matchTacoFoods } from './taco-match';
import type { AskJson } from './taco-match';

/** Junta à análise o alimento da TACO de cada item (ids na ordem dos itens) e a soma dos que entraram na conta. */
export function withMealTaco(analysis: MealPhotoAnalysis, ids: (number | null)[]): MealPhotoAnalysis {
  let counted = 0;
  const total = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  const items: MealPhotoItem[] = analysis.items.map((item, i) => {
    const food = item.grams ? foodById(ids[i]) : null;
    if (!food || !item.grams) return item;
    const portion = foodPortion(food, item.grams);
    // Traço e "não se aplica" contam zero; só alimento em reavaliação fica sem valor.
    const value = (v: number | 'Tr' | null) => (v === 'Tr' ? 0 : v === null ? (food.underReview ? null : 0) : v);
    const taco = { id: food.id, name: food.name, kcal: value(portion.kcal), protein: value(portion.protein), carbs: value(portion.carbs), fat: value(portion.fat) };
    if (typeof taco.kcal === 'number') {
      counted++;
      total.kcal += taco.kcal;
      total.protein += taco.protein ?? 0;
      total.carbs += taco.carbs ?? 0;
      total.fat += taco.fat ?? 0;
    }
    return { ...item, taco };
  });
  return {
    ...analysis,
    items,
    taco: counted ? {
      kcal: Math.round(total.kcal), protein: Math.round(total.protein), carbs: Math.round(total.carbs), fat: Math.round(total.fat),
      counted, items: analysis.items.length,
    } : null,
  };
}

/** Liga os itens da foto à TACO (a IA escolhe entre as opções do app). Sem resposta útil, a análise segue como estava. */
export async function addMealTaco(analysis: MealPhotoAnalysis, ask?: AskJson): Promise<MealPhotoAnalysis> {
  if (!analysis.isFood || !analysis.items.some((item) => item.grams)) return analysis;
  const ids = await matchTacoFoods(analysis.items.map((item) => (item.grams ? item.name : '')), ask);
  return withMealTaco(analysis, ids);
}
