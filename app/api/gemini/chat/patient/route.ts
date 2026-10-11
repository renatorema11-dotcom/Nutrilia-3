import { NextResponse } from "next/server";
import { generateGeminiContent } from "@/lib/gemini";
import { clip, guardAi, lastMessage } from "@/lib/ai-guard";

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const fallbackMessage = "No momento meu sistema está com alto número de acessos, mas estou aqui para apoiar sua alimentação saudável! Lembre-se de manter sua hidratação em dia e seguir os horários do seu plano nutricional. Tente me perguntar novamente em alguns instantes.";

  // Só o paciente logado conversa, com limite de pedidos e de tamanho.
  const guard = await guardAi(req, { roles: ['patient'], scope: 'chat-patient', limit: 30, maxChars: 60_000 });
  if (!guard.ok) return guard.response;

  try {
    const context = clip(guard.body.context, 6000);

    const systemInstruction = `Você é um assistente virtual de nutrição.
O paciente que está falando com você tem o seguinte contexto:
${context}

Seja amigável, conciso e motivador. Responda apenas dúvidas sobre a dieta e nutrição em geral.
Nunca prescreva dietas novas, apenas explique o plano atual ou dê dicas gerais saudáveis.`;

    const message = lastMessage(guard.body.messages, 2000) || "Olá, preciso de ajuda com minha alimentação";

    const result = await generateGeminiContent({
      model: "gemini-2.5-flash",
      contents: message,
      config: { systemInstruction },
      fallbackText: fallbackMessage,
    });

    return NextResponse.json({ text: result.text });
  } catch (error) {
    console.error("Gemini Error:", error);
    return NextResponse.json({ text: fallbackMessage });
  }
}
