import { NextResponse } from "next/server";
import { generateGeminiContent } from "@/lib/gemini";
import { clip, guardAi } from "@/lib/ai-guard";

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const fallbackPlan = `### Plano Criativo de 1 Dia (Sugestão Saudável)

- **Café da Manhã (08:00):** Ovos mexidos com espinafre, 1 fatia de pão integral e chá verde ou café sem açúcar.
- **Almoço (12:30):** Filé de frango ou peixe grelhado com ervas aromáticas, quinoa cozida ou arroz integral, legumes assados (abobrinha e cenoura) e salada verde à vontade.
- **Lanche da Tarde (16:00):** Iogurte natural desnatado com morangos frescos e 1 colher de sopa de sementes de chia.
- **Jantar (19:30):** Sopa nutritiva de abóbora com frango desfiado e um leve toque de gengibre.
- **Ceia (22:00):** Infusão relaxante de camomila com uma porção leve de castanhas ou amêndoas.`;

  // Só o paciente logado pede, com limite de pedidos e de tamanho.
  const guard = await guardAi(req, { roles: ['patient'], scope: 'creative-plan', limit: 10, maxChars: 20_000 });
  if (!guard.ok) return guard.response;

  try {
    const name = clip(guard.body.name, 120);
    const age = clip(guard.body.age, 10);
    const weight = clip(guard.body.weight, 10);
    const height = clip(guard.body.height, 10);
    const objective = clip(guard.body.objective, 200);
    const observations = clip(guard.body.observations, 2000);

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

    const result = await generateGeminiContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      fallbackText: fallbackPlan,
    });

    return NextResponse.json({ text: result.text });
  } catch (error) {
    console.error('Error generating creative plan:', error);
    return NextResponse.json({ text: fallbackPlan });
  }
}
