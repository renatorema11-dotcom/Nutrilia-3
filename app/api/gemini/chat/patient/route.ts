import { NextResponse } from "next/server";
import { aiErrorResponse, generateAi } from "@/lib/ai";
import { clip, guardAi, lastMessage } from "@/lib/ai-guard";

export const runtime = 'nodejs';

// O endereço da rota mantém o nome antigo; a IA que responde é a configurada em lib/ai.ts.
export async function POST(req: Request) {
  // Só o paciente logado conversa, com limite de pedidos e de tamanho.
  const guard = await guardAi(req, { roles: ['patient'], scope: 'chat-patient', limit: 30, maxChars: 60_000 });
  if (!guard.ok) return guard.response;

  try {
    const context = clip(guard.body.context, 6000);

    const systemInstruction = `Você é um assistente virtual de nutrição.
O paciente que está falando com você tem o seguinte contexto:
${context}

Seja amigável, conciso e motivador. Responda apenas dúvidas sobre a dieta e nutrição em geral.
Nunca prescreva dietas novas, apenas explique o plano atual ou dê dicas gerais saudáveis.
Responda em português do Brasil.`;

    const message = lastMessage(guard.body.messages, 2000) || "Olá, preciso de ajuda com minha alimentação";

    const text = await generateAi({ system: systemInstruction, prompt: message, maxTokens: 1000 });

    return NextResponse.json({ text });
  } catch (error) {
    return aiErrorResponse(error, 'chat do paciente');
  }
}
