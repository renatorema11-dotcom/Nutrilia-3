import { NextRequest, NextResponse } from "next/server";
import { generateGeminiContent } from "@/lib/gemini";

export async function POST(req: NextRequest) {
  const fallbackJson = {
    status: "positive",
    feedback: "Excelente registro! Manter o acompanhamento diário das suas refeições é um passo fundamental para atingir seu objetivo com saúde."
  };

  try {
    const { mealName, plannedItems, actualNotes, image, objective } = await req.json();

    const prompt = `Você é um nutricionista analítico e amigável.
O paciente tem o objetivo de: "${objective}".
A refeição planejada para "${mealName}" era: ${plannedItems}.
No entanto, o paciente relatou o seguinte consumo real: "${actualNotes}".
${image ? 'Uma imagem da refeição também foi anexada.' : ''}

Analise o consumo real do paciente em relação ao plano e ao seu objetivo. Se houver uma foto anexa, use-a para estimar o tamanho da porção e a adequação do prato.
Forneça um feedback curto (máximo de 3 parágrafos) em formato JSON, com as seguintes chaves:
- "status": "positive", "neutral", "negative", ou "corrective"
- "feedback": Um texto amigável e direto com o seu feedback para o paciente.

JSON esperado:
{
  "status": "corrective",
  "feedback": "Texto do feedback"
}`;

    let contents: any = prompt;
    
    if (image) {
      const mimeType = image.substring(5, image.indexOf(';'));
      const base64Data = image.substring(image.indexOf(',') + 1);
      
      contents = [
        prompt,
        {
          inlineData: {
            data: base64Data,
            mimeType: mimeType
          }
        }
      ];
    }

    const result = await generateGeminiContent({
      model: "gemini-2.5-flash",
      contents: contents,
      config: {
        responseMimeType: "application/json"
      },
      fallbackJson
    });

    const data = result.json || (result.text ? JSON.parse(result.text) : fallbackJson);

    return NextResponse.json(data);
  } catch (error) {
    console.error("Error analyzing food:", error);
    return NextResponse.json(fallbackJson);
  }
}

