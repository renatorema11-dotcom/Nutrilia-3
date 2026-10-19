// Rascunho de plano alimentar feito pela IA: o mesmo pedido para a tela do prontuário e para a Ali da nutricionista.
// Somente no servidor. O rascunho nunca vai direto para o paciente: a nutricionista revisa e aprova no app.
// Depois do rascunho, cada item é ligado a um alimento da TACO (com o peso estimado) para o app calcular calorias e
// macros. Se essa parte falhar, o rascunho segue sem as contas.
import { generateAiJson, normalizePlan } from './ai';
import type { AiPlanDay, AiRequest } from './ai';
import { foodCandidates } from './food-table';

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

const MATCH_SYSTEM_PROMPT = `Você liga os alimentos de um plano alimentar à Tabela Brasileira de Composição de Alimentos (TACO).
Para cada item, escolha o número da opção da TACO que melhor representa o alimento como ele será consumido (preparo: cozido, cru, grelhado, assado...).
Use somente números que aparecem nas opções do próprio item. Se nenhuma opção representar o alimento, use null.
Responda SOMENTE com JSON válido, sem texto antes ou depois, neste formato: {"escolhas":[{"i":0,"taco":488},{"i":1,"taco":null}]}`;

const MAX_MATCH_ITEMS = 60;
const CANDIDATES_PER_ITEM = 6;

type AskJson = (request: AiRequest) => Promise<Record<string, unknown>>;

/**
 * Liga cada item com peso a um alimento da TACO: a busca do app acha as opções e a IA escolhe uma delas (ou nenhuma).
 * Itens iguais em dias diferentes são perguntados uma vez só. Nunca lança erro: sem resposta útil, o plano segue sem contas.
 */
export async function addPlanFoods(plan: { days: AiPlanDay[] }, ask: AskJson = generateAiJson): Promise<{ days: AiPlanDay[] }> {
  const strip = () => ({ days: plan.days.map((day) => ({ ...day, meals: day.meals.map(({ grams: _grams, ...meal }) => meal) })) });
  const unique: { text: string; options: { id: number; name: string }[] }[] = [];
  const indexOf = new Map<string, number>();
  for (const day of plan.days) {
    for (const meal of day.meals) {
      meal.items.forEach((item, k) => {
        if (!(meal.grams?.[k] ?? 0) || indexOf.has(item) || unique.length >= MAX_MATCH_ITEMS) return;
        const options = foodCandidates(item, CANDIDATES_PER_ITEM).map((food) => ({ id: food.id, name: food.name }));
        if (!options.length) return;
        indexOf.set(item, unique.length);
        unique.push({ text: item, options });
      });
    }
  }
  if (!unique.length) return strip();

  let choices: (number | null)[];
  try {
    const answer = await ask({
      system: MATCH_SYSTEM_PROMPT,
      prompt: unique.map((entry, i) => `${i}. "${entry.text}" → opções: ${entry.options.map((o) => `${o.id} ${o.name}`).join('; ')}`).join('\n'),
      maxTokens: 1500,
    });
    choices = unique.map(() => null);
    for (const raw of Array.isArray(answer.escolhas) ? answer.escolhas : []) {
      const pick = raw as { i?: unknown; taco?: unknown };
      if (typeof pick?.i !== 'number' || !unique[pick.i]) continue;
      // Só vale um número que estava entre as opções daquele item: a IA não inventa alimento.
      if (typeof pick.taco === 'number' && unique[pick.i].options.some((o) => o.id === pick.taco)) choices[pick.i] = pick.taco;
    }
  } catch {
    // Falha da IA aqui já gera aviso lá dentro; o rascunho é o que importa e segue sem as contas.
    return strip();
  }

  return {
    days: plan.days.map((day) => ({
      ...day,
      meals: day.meals.map(({ grams, ...meal }) => {
        const foods = meal.items.map((item, k) => {
          const g = grams?.[k] ?? 0;
          const choice = indexOf.has(item) ? choices[indexOf.get(item) as number] : null;
          return g && choice ? { taco: choice, grams: g } : null;
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
