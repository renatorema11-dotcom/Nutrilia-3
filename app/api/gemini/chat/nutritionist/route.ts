import { NextRequest, NextResponse } from "next/server";
import { generateGeminiContent } from "@/lib/gemini";

export async function POST(req: NextRequest) {
  const fallbackMessage = "Sistema de IA operando sob alta demanda no momento. Recomendo verificar os relatórios recentes dos pacientes na lista clínica e a aba de evolução dos planos enquanto a conexão é restabelecida.";

  try {
    const { messages, context } = await req.json();

    const systemInstruction = `Você é um assistente de IA focado em apoiar o nutricionista.
Seu papel é analisar dados dos pacientes, resumir casos, sugerir ajustes e identificar alertas (como pacientes que não retornam há tempos).
Aja como um co-piloto clínico. Responda de forma direta e estruturada.

Dados disponíveis dos pacientes na clínica:
${context}`;

    const lastMessage = messages?.[messages.length - 1]?.text || "Resuma a situação da clínica.";

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

