// Rascunho de plano alimentar feito pela IA: o mesmo pedido para a tela do prontuário e para a Ali da nutricionista.
// Somente no servidor. O rascunho nunca vai direto para o paciente: a nutricionista revisa e aprova no app.
// Depois do rascunho, cada item é ligado a um alimento da TACO (com o peso estimado) para o app calcular calorias e
// macros. Se essa parte falhar, o rascunho segue sem as contas.
import { generateAiJson, normalizePlan } from './ai';
import type { AiPlanDay, AiRequest } from './ai';
import { matchTacoFoods, type AskJson } from './taco-match';

export const PLAN_SYSTEM_PROMPT = `Você é um assistente de IA para nutricionistas brasileiros. Gere um rascunho de plano alimentar com base nos dados do paciente e nas diretrizes do nutricionista.
Responda SOMENTE com um objeto JSON válido, sem texto antes ou depois, neste formato:
{"days":[{"name":"Segunda a Sexta","meals":[{"time":"08:00","name":"Café da Manhã","items":["2 ovos mexidos","1 fatia de pão integral"],"gramas":[100,30]}]}]}
- "days": de 1 a 3 grupos de dias (ex.: "Segunda a Sexta", "Fim de Semana").
- "meals": as refeições do dia, em ordem, com horário no formato HH:MM.
- "items": alimentos com quantidade, em português do Brasil, um alimento por item.
- "gramas": o peso estimado em gramas de cada item, pronto para comer, na mesma ordem de "items".`;

/** O pedido à IA: dados do paciente (sem o nome) e as orientações da nutricionista. */
export function planRequest(patientContext: string, instructions: string): AiRequest {
  return {
    system: PLAN_SYSTEM_PROMPT,
    prompt: `Contexto do paciente: ${patientContext}\nInstruções adicionais do nutricionista: ${instructions || 'nenhuma'}`,
    maxTokens: 4000,
  };
}

/**
 * Liga cada item com peso a um alimento da TACO (lib/taco-match.ts) e guarda em meal.foods, na ordem de meal.items.
 * Nunca lança erro: sem resposta útil, o plano segue sem as contas.
 */
export async function addPlanFoods(plan: { days: AiPlanDay[] }, ask: AskJson = generateAiJson): Promise<{ days: AiPlanDay[] }> {
  const strip = () => ({ days: plan.days.map((day) => ({ ...day, meals: day.meals.map(({ grams: _grams, ...meal }) => meal) })) });
  // Só os itens com peso entram na conta; os outros nem são perguntados.
  const texts = plan.days.flatMap((day) => day.meals.flatMap((meal) => meal.items.map((item, k) => ((meal.grams?.[k] ?? 0) ? item : ''))));
  if (!texts.some(Boolean)) return strip();
  const ids = await matchTacoFoods(texts, ask);
  if (!ids.some((id) => id !== null)) return strip();
  let next = 0;
  return {
    days: plan.days.map((day) => ({
      ...day,
      meals: day.meals.map(({ grams, ...meal }) => {
        const foods = meal.items.map((_, k) => {
          const id = ids[next++];
          const g = grams?.[k] ?? 0;
          return g && id !== null ? { taco: id, grams: g } : null;
        });
        return foods.some(Boolean) ? { ...meal, foods } : meal;
      }),
    })),
  };
}

/** Gera o rascunho (com os alimentos da TACO quando der) e devolve só o que veio no formato certo. */
export async function generatePlanDraft(patientContext: string, instructions: string): Promise<{ days: AiPlanDay[] }> {
  return addPlanFoods(normalizePlan(await generateAiJson(planRequest(patientContext, instructions))));
}
