import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });

    const { messages, context } = await req.json();

    const chat = ai.chats.create({
      model: "gemini-3.5-flash",
      config: {
        systemInstruction: `Você é um assistente de IA focado em apoiar o nutricionista.
Seu papel é analisar dados dos pacientes, resumir casos, sugerir ajustes e identificar alertas (como pacientes que não retornam há tempos).
Aja como um co-piloto clínico. Responda de forma direta e estruturada.

Dados disponíveis dos pacientes na clínica:
${context}`,
      }
    });

    const lastMessage = messages[messages.length - 1].text;
    const response = await chat.sendMessage({ message: lastMessage });

    return NextResponse.json({ text: response.text });
  } catch (error) {
    console.error("Gemini Error:", error);
    return NextResponse.json({ error: 'Erro ao conectar com a IA.' }, { status: 500 });
  }
}
