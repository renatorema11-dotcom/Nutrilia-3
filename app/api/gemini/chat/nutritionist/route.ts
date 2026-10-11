import { NextResponse } from "next/server";
import { generateGeminiContent } from "@/lib/gemini";
import { clip, guardAi, lastMessage } from "@/lib/ai-guard";

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const fallbackMessage = "Sistema de IA operando sob alta demanda no momento. Recomendo verificar os relatórios recentes dos pacientes na lista clínica e a aba de evolução dos planos enquanto a conexão é restabelecida.";

  // Só a nutricionista logada usa, com limite de pedidos e de tamanho.
  const guard = await guardAi(req, { roles: ['nutritionist'], scope: 'chat-nutritionist', limit: 30, maxChars: 200_000 });
  if (!guard.ok) return guard.response;

  try {
    const context = clip(guard.body.context, 60_000);

    const systemInstruction = `Você é um assistente de IA focado em apoiar o nutricionista.
Seu papel é analisar dados dos pacientes, resumir casos, sugerir ajustes e identificar alertas (como pacientes que não retornam há tempos).
Aja como um co-piloto clínico. Responda de forma direta e estruturada.

Dados disponíveis dos pacientes na clínica:
${context}`;

    const message = lastMessage(guard.body.messages, 4000) || "Resuma a situação da clínica.";

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
