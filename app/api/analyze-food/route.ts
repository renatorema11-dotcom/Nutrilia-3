import { NextResponse } from "next/server";
import { AiError, aiErrorResponse, generateAiJson, normalizeFoodFeedback } from "@/lib/ai";
import { clip, guardAi, parseImage } from "@/lib/ai-guard";

export const runtime = 'nodejs';

// Foto maior que isto (cerca de 2,5 MB) não segue para a IA; a tela já reduz a foto antes de enviar.
const MAX_IMAGE_BASE64 = 3_500_000;

export async function POST(req: Request) {
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
    if (image && image.data.length > MAX_IMAGE_BASE64) {
      return NextResponse.json({ error: 'A foto ficou grande demais. Tire outra ou escolha uma menor.' }, { status: 413 });
    }

    const buildPrompt = (withImage: boolean) => `Você é um nutricionista analítico e amigável.
${objective ? `O paciente tem o objetivo de: "${objective}".` : 'O paciente ainda não informou o objetivo: não suponha um.'}
A refeição planejada para "${mealName}" era: ${plannedItems}.
No entanto, o paciente relatou o seguinte consumo real: "${actualNotes}".
${withImage ? 'Uma imagem da refeição também foi anexada.' : ''}

Analise o consumo real do paciente em relação ao plano e ao seu objetivo. Se houver uma foto anexa, use-a para estimar o tamanho da porção e a adequação do prato.
Forneça um feedback curto (máximo de 3 parágrafos), em português do Brasil, SOMENTE em formato JSON, sem texto antes ou depois, com as seguintes chaves:
- "status": "positive", "neutral", "negative", ou "corrective"
- "feedback": Um texto amigável e direto com o seu feedback para o paciente.

JSON esperado:
{
  "status": "corrective",
  "feedback": "Texto do feedback"
}`;

    if (image) {
      try {
        const data = await generateAiJson({ prompt: buildPrompt(true), image, maxTokens: 900 });
        return NextResponse.json(normalizeFoodFeedback(data));
      } catch (error) {
        // Limite de uso estourado: avisa. Qualquer outra falha com a foto: analisa só o texto e conta isso ao paciente.
        if (error instanceof AiError && error.status === 429) throw error;
      }
    }

    const result = normalizeFoodFeedback(await generateAiJson({ prompt: buildPrompt(false), maxTokens: 900 }));
    if (image) result.feedback += ' (Não consegui analisar a foto agora; avaliei pelo que você escreveu.)';
    return NextResponse.json(result);
  } catch (error) {
    return aiErrorResponse(error, 'análise de refeição');
  }
}
