import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: { 'User-Agent': 'aistudio-build' }
      }
    });

    const { messages, context } = await req.json();

    // Use gemini-3.5-flash for standard chat interactions
    const chat = ai.chats.create({
      model: "gemini-3.5-flash",
      config: {
        systemInstruction: `Você é um assistente virtual de nutrição. 
O paciente que está falando com você tem o seguinte contexto:
${context}

Seja amigável, conciso e motivador. Responda apenas dúvidas sobre a dieta e nutrição em geral.
Nunca prescreva dietas novas, apenas explique o plano atual ou dê dicas gerais saudáveis.`,
      }
    });

    // Send history to establish state, then the last message
    // Actually, simple approach: just send the latest message with history inside if we had it,
    // or simulate it by passing all user text. For now, let's just send the last user message.
    
    // In a real app we would use chat history properly, but for this mock let's just send the latest prompt.
    // If messages array has more than 1, we should ideally format it.
    const lastMessage = messages[messages.length - 1].text;
    
    const response = await chat.sendMessage({ message: lastMessage });

    return NextResponse.json({ text: response.text });
  } catch (error) {
    console.error("Gemini Error:", error);
    return NextResponse.json({ error: 'Erro ao conectar com a IA.' }, { status: 500 });
  }
}
