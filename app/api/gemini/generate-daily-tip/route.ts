import { NextResponse } from "next/server";
import { aiErrorResponse, generateAi } from "@/lib/ai";
import { clip, guardAi } from "@/lib/ai-guard";

export const runtime = 'nodejs';

// O endereço da rota mantém o nome antigo; a IA que responde é a configurada em lib/ai.ts.
export async function POST(req: Request) {
  // Só o paciente logado pede, com limite de pedidos e de tamanho.
  const guard = await guardAi(req, { roles: ['patient'], scope: 'daily-tip', limit: 20, maxChars: 2000 });
  if (!guard.ok) return guard.response;

  try {
    const objective = clip(guard.body.objective, 200);

    const prompt = `Você é um nutricionista especialista. Forneça UMA dica diária curta, motivacional e prática sobre nutrição e saúde focada no seguinte objetivo: "${objective || 'Saúde e Bem-estar'}".
Seja direto, sem introduções, em português do Brasil. Use, no máximo, 2 frases curtas.`;

    const text = await generateAi({ prompt, maxTokens: 500 });

    return NextResponse.json({ text });
  } catch (error) {
    return aiErrorResponse(error, 'dica do dia');
  }
}
