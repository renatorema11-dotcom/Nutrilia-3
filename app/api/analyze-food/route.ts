import { NextResponse } from "next/server";
import { generateGeminiContent } from "@/lib/gemini";
import { clip, guardAi, parseImage } from "@/lib/ai-guard";

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const fallbackJson = {
    status: "positive",
    feedback: "Excelente registro! Manter o acompanhamento diário das suas refeições é um passo fundamental para atingir seu objetivo com saúde."
  };

  // Só o paciente logado envia, com limite de pedidos; a foto cabe em até cerca de 6 MB.
  const guard = await guardAi(req, { roles: ['patient'], scope: 'analyze-food', limit: 20, maxChars: 8_500_000 });
  if (!guard.ok) return guard.response;

  try {
    const mealName = clip(guard.body.mealName, 120);
    const plannedItems = clip(Array.isArray(guard.body.plannedItems) ? guard.body.plannedItems.join(', ') : guard.body.plannedItems, 2000);
    const actualNotes = clip(guard.body.actualNotes, 2000);
    const objective = clip(guard.body.objective, 200);
    // Só JPEG, PNG ou WebP: outro tipo de arquivo não segue para a IA.
    const image = parseImage(guard.body.image);
    if (guard.body.image && !image) return NextResponse.json({ error: 'Envie a foto em JPG, PNG ou WebP.' }, { status: 422 });

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

    const contents = image ? [prompt, { inlineData: { data: image.data, mimeType: image.mimeType } }] : prompt;

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
