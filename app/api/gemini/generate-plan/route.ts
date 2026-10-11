import { NextResponse } from "next/server";
import { aiErrorResponse, generateAiJson, normalizePlan } from "@/lib/ai";
import { clip, guardAi } from "@/lib/ai-guard";

export const runtime = 'nodejs';

// O endereço da rota mantém o nome antigo; a IA que responde é a configurada em lib/ai.ts.
export async function POST(req: Request) {
  // Só a nutricionista logada gera rascunhos, com limite de pedidos e de tamanho.
  const guard = await guardAi(req, { roles: ['nutritionist'], scope: 'generate-plan', limit: 15, maxChars: 40_000 });
  if (!guard.ok) return guard.response;

  try {
    const patientContext = clip(guard.body.patientContext, 3000);
    const instructions = clip(guard.body.instructions, 2000);

    const data = await generateAiJson({
      system: `Você é um assistente de IA para nutricionistas brasileiros. Gere um rascunho de plano alimentar com base nos dados do paciente e nas diretrizes do nutricionista.
Responda SOMENTE com um objeto JSON válido, sem texto antes ou depois, neste formato:
{"days":[{"name":"Segunda a Sexta","meals":[{"time":"08:00","name":"Café da Manhã","items":["2 ovos mexidos","1 fatia de pão integral"]}]}]}
- "days": de 1 a 3 grupos de dias (ex.: "Segunda a Sexta", "Fim de Semana").
- "meals": as refeições do dia, em ordem, com horário no formato HH:MM.
- "items": alimentos com quantidade, em português do Brasil.`,
      prompt: `Contexto do paciente: ${patientContext}\nInstruções adicionais do nutricionista: ${instructions || 'nenhuma'}`,
      maxTokens: 4000,
    });

    // Só segue para a tela o que veio no formato certo; se não vier nada aproveitável, a nutricionista é avisada.
    return NextResponse.json({ data: normalizePlan(data) });
  } catch (error) {
    return aiErrorResponse(error, 'geração de plano');
  }
}
