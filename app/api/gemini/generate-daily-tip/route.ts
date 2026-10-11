import { NextResponse } from "next/server";
import { generateGeminiContent } from "@/lib/gemini";
import { clip, guardAi } from "@/lib/ai-guard";

export const runtime = 'nodejs';

const FALLBACK_TIP = "Beba pelo menos 2 litros de água hoje e priorize alimentos naturais em todas as suas refeições para manter o bem-estar e atingir seus objetivos com saúde!";

export async function POST(req: Request) {
  // Só o paciente logado pede, com limite de pedidos e de tamanho.
  const guard = await guardAi(req, { roles: ['patient'], scope: 'daily-tip', limit: 20, maxChars: 2000 });
  if (!guard.ok) return guard.response;

  try {
    const objective = clip(guard.body.objective, 200);

    const prompt = `Você é um nutricionista especialista. Forneça UMA dica diária curta, motivacional e prática sobre nutrição e saúde focada no seguinte objetivo: "${objective || 'Saúde e Bem-estar'}".
Seja direto, sem introduções. Use, no máximo, 2 frases curtas.`;

    const result = await generateGeminiContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      fallbackText: FALLBACK_TIP,
    });

    return NextResponse.json({ text: result.text });
  } catch (error) {
    console.error('Error generating daily tip:', error);
    return NextResponse.json({ text: FALLBACK_TIP });
  }
}
