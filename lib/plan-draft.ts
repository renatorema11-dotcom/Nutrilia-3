// Rascunho de plano alimentar feito pela IA: o mesmo pedido para a tela do prontuário e para a Ali da nutricionista.
// Somente no servidor. O rascunho nunca vai direto para o paciente: a nutricionista revisa e aprova no app.
import { generateAiJson, normalizePlan } from './ai';
import type { AiPlanDay, AiRequest } from './ai';

export const PLAN_SYSTEM_PROMPT = `Você é um assistente de IA para nutricionistas brasileiros. Gere um rascunho de plano alimentar com base nos dados do paciente e nas diretrizes do nutricionista.
Responda SOMENTE com um objeto JSON válido, sem texto antes ou depois, neste formato:
{"days":[{"name":"Segunda a Sexta","meals":[{"time":"08:00","name":"Café da Manhã","items":["2 ovos mexidos","1 fatia de pão integral"]}]}]}
- "days": de 1 a 3 grupos de dias (ex.: "Segunda a Sexta", "Fim de Semana").
- "meals": as refeições do dia, em ordem, com horário no formato HH:MM.
- "items": alimentos com quantidade, em português do Brasil.`;

/** O pedido à IA: dados do paciente (sem o nome) e as orientações da nutricionista. */
export function planRequest(patientContext: string, instructions: string): AiRequest {
  return {
    system: PLAN_SYSTEM_PROMPT,
    prompt: `Contexto do paciente: ${patientContext}\nInstruções adicionais do nutricionista: ${instructions || 'nenhuma'}`,
    maxTokens: 4000,
  };
}

/** Gera o rascunho e devolve só o que veio no formato certo (lança AiError se não sobrar nada aproveitável). */
export async function generatePlanDraft(patientContext: string, instructions: string): Promise<{ days: AiPlanDay[] }> {
  return normalizePlan(await generateAiJson(planRequest(patientContext, instructions)));
}
