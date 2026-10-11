import { NextResponse } from "next/server";
import { aiErrorResponse, generateAi } from "@/lib/ai";
import { clip, guardAi, lastMessage } from "@/lib/ai-guard";

export const runtime = 'nodejs';

// O endereço da rota mantém o nome antigo; a IA que responde é a configurada em lib/ai.ts.
export async function POST(req: Request) {
  // Só a nutricionista logada usa, com limite de pedidos e de tamanho.
  const guard = await guardAi(req, { roles: ['nutritionist'], scope: 'chat-nutritionist', limit: 30, maxChars: 200_000 });
  if (!guard.ok) return guard.response;

  try {
    // O resumo dos pacientes é cortado para caber no limite por minuto da IA.
    const context = clip(guard.body.context, 12_000);

    const systemInstruction = `Você é um assistente de IA focado em apoiar o nutricionista.
Seu papel é analisar dados dos pacientes, resumir casos, sugerir ajustes e identificar alertas (como pacientes que não retornam há tempos).
Aja como um co-piloto clínico. Responda de forma direta e estruturada, em português do Brasil.
Use só os dados abaixo; se a informação pedida não estiver neles, diga que não tem esse dado.

Dados disponíveis dos pacientes na clínica:
${context}`;

    const message = lastMessage(guard.body.messages, 4000) || "Resuma a situação da clínica.";

    const text = await generateAi({ system: systemInstruction, prompt: message, maxTokens: 1200 });

    return NextResponse.json({ text });
  } catch (error) {
    return aiErrorResponse(error, 'assistente da nutricionista');
  }
}
