// Gemini como IA reserva: só é usado quando não há GROQ_API_KEY e existe GEMINI_API_KEY (ver lib/ai.ts).
import { GoogleGenAI } from "@google/genai";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

interface GeminiRequest {
  system?: string;
  history?: { role: 'user' | 'assistant'; text: string }[];
  prompt: string;
  image?: { mimeType: string; data: string } | null;
}

/** Pede um texto ao Gemini. Em caso de falha lança o erro; quem chama decide o aviso mostrado à pessoa. */
export async function generateWithGemini(request: GeminiRequest, apiKey: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  const contents = request.image
    ? [request.prompt, { inlineData: { data: request.image.data, mimeType: request.image.mimeType } }]
    : request.history?.length
      ? [
          ...request.history.map((turn) => ({ role: turn.role === 'user' ? 'user' : 'model', parts: [{ text: turn.text }] })),
          { role: 'user', parts: [{ text: request.prompt }] },
        ]
      : request.prompt;

  let lastError: unknown = new Error("Gemini devolveu resposta vazia.");
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
        contents,
        config: { systemInstruction: request.system },
      });
      if (response.text) return response.text;
    } catch (error) {
      lastError = error;
      const message = String((error as Error)?.message || error);
      // Só vale tentar de novo quando o serviço está sobrecarregado.
      if (!/503|UNAVAILABLE|high demand/i.test(message)) break;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
  throw lastError;
}
