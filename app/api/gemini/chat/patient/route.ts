import { NextRequest, NextResponse } from "next/server";
import { generateGeminiContent } from "@/lib/gemini";

export async function POST(req: NextRequest) {
  const fallbackMessage = "No momento meu sistema está com alto número de acessos, mas estou aqui para apoiar sua alimentação saudável! Lembre-se de manter sua hidratação em dia e seguir os horários do seu plano nutricional. Tente me perguntar novamente em alguns instantes.";

  try {
    const { messages, context } = await req.json();

    const systemInstruction = `Você é um assistente virtual de nutrição. 
O paciente que está falando com você tem o seguinte contexto:
${context}

Seja amigável, conciso e motivador. Responda apenas dúvidas sobre a dieta e nutrição em geral.
Nunca prescreva dietas novas, apenas explique o plano atual ou dê dicas gerais saudáveis.`;

    const lastMessage = messages?.[messages.length - 1]?.text || "Olá, preciso de ajuda com minha alimentação";

    const result = await generateGeminiContent({
      model: "gemini-2.5-flash",
      contents: lastMessage,
      config: { systemInstruction },
      fallbackText: fallbackMessage,
    });

    return NextResponse.json({ text: result.text });
  } catch (error) {
    console.error("Gemini Error:", error);
    return NextResponse.json({ text: fallbackMessage });
  }
}

