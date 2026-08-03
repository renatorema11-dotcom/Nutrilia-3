import { NextRequest, NextResponse } from "next/server";
import { generateGeminiContent } from "@/lib/gemini";

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();
    const { objective } = data;

    const prompt = `Você é um nutricionista especialista. Forneça UMA dica diária curta, motivacional e prática sobre nutrição e saúde focada no seguinte objetivo: "${objective || 'Saúde e Bem-estar'}". 
Seja direto, sem introduções. Use, no máximo, 2 frases curtas.`;

    const result = await generateGeminiContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      fallbackText: "Beba pelo menos 2 litros de água hoje e priorize alimentos naturais em todas as suas refeições para manter o bem-estar e atingir seus objetivos com saúde!",
    });

    return NextResponse.json({ text: result.text });
  } catch (error) {
    console.error('Error generating daily tip:', error);
    return NextResponse.json({
      text: "Beba pelo menos 2 litros de água hoje e priorize alimentos naturais em todas as suas refeições para manter o bem-estar e atingir seus objetivos com saúde!"
    });
  }
}

