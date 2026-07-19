import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const data = await req.json();
    const { objective } = data;

    const prompt = `Você é um nutricionista especialista. Forneça UMA dica diária curta, motivacional e prática sobre nutrição e saúde focada no seguinte objetivo: "${objective || 'Saúde e Bem-estar'}". 
Seja direto, sem introduções. Use, no máximo, 2 frases curtas.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
    });

    return NextResponse.json({ text: response.text });
  } catch (error) {
    console.error('Error generating daily tip:', error);
    return NextResponse.json({ error: 'Failed to generate tip' }, { status: 500 });
  }
}
