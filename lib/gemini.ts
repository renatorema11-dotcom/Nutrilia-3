import { GoogleGenAI } from "@google/genai";

export interface GenerateOptions {
  model?: string;
  contents: any;
  config?: any;
  fallbackText?: string;
  fallbackJson?: any;
}

export async function generateGeminiContent(options: GenerateOptions): Promise<{ text: string; json?: any }> {
  const {
    model = "gemini-2.5-flash",
    contents,
    config,
    fallbackText = "",
    fallbackJson,
  } = options;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    if (fallbackJson) {
      return { text: JSON.stringify(fallbackJson), json: fallbackJson };
    }
    return { text: fallbackText };
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: { "User-Agent": "aistudio-build" },
    },
  });

  const maxAttempts = 3;
  let delay = 800;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Use the specified model on attempt 1, or toggle between gemini-2.5-flash and gemini-3.5-flash on retry
      let currentModel = model;
      if (attempt > 1) {
        currentModel =
          model === "gemini-3.5-flash"
            ? "gemini-2.5-flash"
            : "gemini-3.5-flash";
      }

      const response = await ai.models.generateContent({
        model: currentModel,
        contents,
        config,
      });

      const text = response.text || "";
      if (text) {
        let json: any = undefined;
        if (config?.responseMimeType === "application/json") {
          try {
            json = JSON.parse(text);
          } catch {
            json = fallbackJson;
          }
        }
        return { text, json };
      }
    } catch (error: any) {
      const errMessage = String(error?.message || error || "");
      const isTransient =
        errMessage.includes("503") ||
        errMessage.includes("UNAVAILABLE") ||
        errMessage.includes("429") ||
        errMessage.includes("RESOURCE_EXHAUSTED") ||
        errMessage.includes("high demand") ||
        errMessage.includes("quota");

      if (isTransient && attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
        continue;
      }

      if (attempt === maxAttempts) {
        console.warn("Gemini API fallback triggered after retries:", errMessage);
      }
    }
  }

  // Gracefully return fallback if all retries failed due to high demand
  if (fallbackJson) {
    return { text: JSON.stringify(fallbackJson), json: fallbackJson };
  }
  return { text: fallbackText };
}
