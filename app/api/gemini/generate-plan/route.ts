import { NextResponse } from "next/server";
import { aiErrorResponse, generateAiJson, normalizePlan } from "@/lib/ai";
import { clip, guardAi } from "@/lib/ai-guard";
import { planRequest } from "@/lib/plan-draft";

export const runtime = 'nodejs';

// O endereço da rota mantém o nome antigo; a IA que responde é a configurada em lib/ai.ts.
export async function POST(req: Request) {
  // Só a nutricionista logada gera rascunhos, com limite de pedidos e de tamanho.
  const guard = await guardAi(req, { roles: ['nutritionist'], scope: 'generate-plan', limit: 15, maxChars: 40_000 });
  if (!guard.ok) return guard.response;

  try {
    const patientContext = clip(guard.body.patientContext, 3000);
    const instructions = clip(guard.body.instructions, 2000);

    // O mesmo pedido que a Ali da nutricionista usa para montar o rascunho por voz (lib/plan-draft.ts).
    const data = await generateAiJson(planRequest(patientContext, instructions));

    // Só segue para a tela o que veio no formato certo; se não vier nada aproveitável, a nutricionista é avisada.
    return NextResponse.json({ data: normalizePlan(data) });
  } catch (error) {
    return aiErrorResponse(error, 'geração de plano');
  }
}
