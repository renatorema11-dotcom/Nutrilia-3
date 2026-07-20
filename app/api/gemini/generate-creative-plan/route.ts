import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const data = await req.json();
    const { name, age, weight, height, objective, observations } = data;

    const prompt = `Você é um nutricionista criativo e especialista. 
Baseado nas seguintes informações do paciente:
- Nome: ${name || 'Paciente'}
- Idade: ${age || 'N/A'}
- Peso: ${weight || 'N/A'} kg
- Altura: ${height || 'N/A'} cm
- Objetivo: ${objective || 'Saúde e Bem-estar'}
${observations ? `- Observações/Preferências: ${observations}` : ''}

Crie um "Plano Criativo" (Menu de 1 dia) inovador, saboroso e alinhado ao objetivo do paciente e suas observações (se houver).
Formate a resposta em Markdown limpo, sem marcações ou introduções genéricas. Seja direto e inspirador.`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
    });

    return NextResponse.json({ text: response.text });
  } catch (error) {
    console.error('Error generating creative plan:', error);
    return NextResponse.json({ error: 'Failed to generate plan' }, { status: 500 });
  }
}
