import { NextResponse } from "next/server";
import { aiErrorResponse } from "@/lib/ai";
import { clip, guardAi } from "@/lib/ai-guard";
import { generatePlanDraft } from "@/lib/plan-draft";
import { getAdminDb } from "@/lib/firebase-admin";
import { patientOf } from "@/lib/consultation-notes";
import { planBrainContext } from "@/lib/nutritionist-brain";

export const runtime = 'nodejs';

// O endereço da rota mantém o nome antigo; a IA que responde é a configurada em lib/ai.ts.
export async function POST(req: Request) {
  // Só a nutricionista logada gera rascunhos, com limite de pedidos e de tamanho.
  const guard = await guardAi(req, { roles: ['nutritionist'], scope: 'generate-plan', limit: 15, maxChars: 40_000 });
  if (!guard.ok) return guard.response;

  try {
    let patientContext = clip(guard.body.patientContext, 3000);
    // Com o paciente (só se for dela), entram a ficha clínica e as preferências de trabalho da nutricionista.
    if (typeof guard.body.patientId === 'string') {
      try {
        const db = getAdminDb();
        const patient = await patientOf(db, guard.caller.uid, guard.body.patientId);
        if (patient) {
          let base: Record<string, unknown> = {};
          try { const parsed = JSON.parse(patientContext); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) base = parsed; } catch { base = { contexto: patientContext }; }
          patientContext = JSON.stringify({ ...base, ...(await planBrainContext(db, guard.caller.uid, patient.uid)) });
        }
      } catch {
        // Sem a ficha, o rascunho sai só com os dados da tela, como antes.
      }
    }
    const instructions = clip(guard.body.instructions, 2000);

    // O mesmo rascunho que a Ali da nutricionista monta por voz (lib/plan-draft.ts), com os alimentos da TACO para as
    // contas de calorias e macros. Só segue para a tela o que veio no formato certo.
    return NextResponse.json({ data: await generatePlanDraft(patientContext, instructions) });
  } catch (error) {
    return aiErrorResponse(error, 'geração de plano');
  }
}
