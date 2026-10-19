import { NextResponse } from "next/server";
import { aiErrorResponse } from "@/lib/ai";
import { clip, guardAi } from "@/lib/ai-guard";
import { generatePlanDraft } from "@/lib/plan-draft";

export const runtime = 'nodejs';

// O endereço da rota mantém o nome antigo; a IA que responde é a configurada em lib/ai.ts.
export async function POST(req: Request) {
  // Só a nutricionista logada gera rascunhos, com limite de pedidos e de tamanho.
  const guard = await guardAi(req, { roles: ['nutritionist'], scope: 'generate-plan', limit: 15, maxChars: 40_000 });
  if (!guard.ok) return guard.response;

  try {
    const patientContext = clip(guard.body.patientContext, 3000);
    const instructions = clip(guard.body.instructions, 2000);

    // O mesmo rascunho que a Ali da nutricionista monta por voz (lib/plan-draft.ts), com os alimentos da TACO para as
    // contas de calorias e macros. Só segue para a tela o que veio no formato certo.
    return NextResponse.json({ data: await generatePlanDraft(patientContext, instructions) });
  } catch (error) {
    return aiErrorResponse(error, 'geração de plano');
  }
}
