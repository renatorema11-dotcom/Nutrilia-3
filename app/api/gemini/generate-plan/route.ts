import { GoogleGenAI, Type } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });

    const { patientContext, instructions } = await req.json();

    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: `Gere um rascunho de plano alimentar para o seguinte paciente.
Contexto do paciente: ${patientContext}
Instruções adicionais do nutricionista: ${instructions}`,
      config: {
        systemInstruction: "Você é um assistente de IA para nutricionistas. Gere um plano alimentar estruturado em JSON com base nos dados do paciente e diretrizes.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            days: {
              type: Type.ARRAY,
              description: "Dias da semana (ex: 'Segunda a Sexta', 'Fim de Semana')",
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  meals: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        time: { type: Type.STRING, description: "Horário da refeição (ex: 08:00)" },
                        name: { type: Type.STRING, description: "Nome da refeição (ex: Café da Manhã)" },
                        items: { 
                          type: Type.ARRAY, 
                          items: { type: Type.STRING },
                          description: "Lista de alimentos e quantidades"
                        }
                      },
                      required: ["time", "name", "items"]
                    }
                  }
                },
                required: ["name", "meals"]
              }
            }
          },
          required: ["days"]
        }
      }
    });

    return NextResponse.json({ data: JSON.parse(response.text || '{}') });
  } catch (error) {
    console.error("Gemini Generate Plan Error:", error);
    return NextResponse.json({ error: 'Erro ao gerar o plano.' }, { status: 500 });
  }
}
