import { NextResponse } from "next/server";
import { aiErrorResponse, generateAi } from "@/lib/ai";
import { clip, guardAi } from "@/lib/ai-guard";

export const runtime = 'nodejs';

// O endereço da rota mantém o nome antigo; a IA que responde é a configurada em lib/ai.ts.
export async function POST(req: Request) {
  // Só o paciente logado pede, com limite de pedidos e de tamanho.
  const guard = await guardAi(req, { roles: ['patient'], scope: 'creative-plan', limit: 10, maxChars: 20_000 });
  if (!guard.ok) return guard.response;

  try {
    // O nome do paciente não é enviado à IA: ela não precisa dele para montar o cardápio.
    const age = clip(guard.body.age, 10);
    const weight = clip(guard.body.weight, 10);
    const height = clip(guard.body.height, 10);
    const objective = clip(guard.body.objective, 200);
    const observations = clip(guard.body.observations, 2000);

    const prompt = `Você é um nutricionista criativo e especialista.
Baseado nas seguintes informações do paciente:
- Idade: ${age || 'N/A'}
- Peso: ${weight || 'N/A'} kg
- Altura: ${height || 'N/A'} cm
- Objetivo: ${objective || 'Saúde e Bem-estar'}
${observations ? `- Observações/Preferências: ${observations}` : ''}

Crie um "Plano Criativo" (Menu de 1 dia) inovador, saboroso e alinhado ao objetivo do paciente e suas observações (se houver).
Formate a resposta em Markdown limpo, em português do Brasil, sem marcações ou introduções genéricas. Seja direto e inspirador.`;

    const text = await generateAi({ prompt, maxTokens: 1500 });

    return NextResponse.json({ text });
  } catch (error) {
    return aiErrorResponse(error, 'plano criativo');
  }
}
