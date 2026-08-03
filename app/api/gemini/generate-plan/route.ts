import { Type } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { generateGeminiContent } from "@/lib/gemini";

export async function POST(req: NextRequest) {
  const fallbackJson = {
    days: [
      {
        name: "Segunda a Sexta (Plano Sugerido)",
        meals: [
          {
            time: "08:00",
            name: "Café da Manhã",
            items: ["2 Ovos mexidos", "1 Fatia de pão integral", "1 Fruta da estação"]
          },
          {
            time: "12:30",
            name: "Almoço",
            items: ["150g de Filé de frango ou peixe grelhado", "4 colheres de sopa de Arroz integral", "1 concha de Feijão", "Salada verde à vontade"]
          },
          {
            time: "16:00",
            name: "Lanche da Tarde",
            items: ["1 Iogurte natural desnatado", "1 porção de castanhas ou nozes"]
          },
          {
            time: "19:30",
            name: "Jantar",
            items: ["120g de Proteína magra grelhada", "Legumes cozidos no vapor", "Salada de folhas variadas"]
          }
        ]
      }
    ]
  };

  try {
    const { patientContext, instructions } = await req.json();

    const result = await generateGeminiContent({
      model: "gemini-2.5-flash",
      contents: `Gere um rascunho de plano alimentar para o seguinte paciente.\nContexto do paciente: ${patientContext}\nInstruções adicionais do nutricionista: ${instructions}`,
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
      },
      fallbackJson
    });

    const parsedData = result.json || (result.text ? JSON.parse(result.text) : fallbackJson);

    return NextResponse.json({ data: parsedData });
  } catch (error) {
    console.error("Gemini Generate Plan Error:", error);
    return NextResponse.json({ data: fallbackJson });
  }
}

