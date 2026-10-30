// Liga textos livres ("2 ovos mexidos", "arroz branco") a alimentos da TACO: a busca do app acha as opções de cada
// texto e a IA escolhe uma delas (ou nenhuma). Serve ao rascunho de plano e à foto do prato. Somente no servidor.
import { generateAiJson } from './ai';
import type { AiRequest } from './ai';
import { foodCandidates } from './food-table';

const TACO_MATCH_PROMPT = `Você liga alimentos à Tabela Brasileira de Composição de Alimentos (TACO).
Para cada item, escolha o número da opção da TACO que melhor representa o alimento como ele será consumido (preparo: cozido, cru, grelhado, assado...).
Use somente números que aparecem nas opções do próprio item. Se nenhuma opção representar o alimento, use null.
Responda SOMENTE com JSON válido, sem texto antes ou depois, neste formato: {"escolhas":[{"i":0,"taco":488},{"i":1,"taco":null}]}`;

const MAX_MATCH_TEXTS = 60;
const OPTIONS_PER_TEXT = 6;

export type AskJson = (request: AiRequest) => Promise<Record<string, unknown>>;

/**
 * Número da TACO para cada texto, na mesma ordem (null = sem alimento correspondente ou texto vazio).
 * Textos repetidos são perguntados uma vez só. Nunca lança erro: se a IA falhar, todos ficam null.
 */
export async function matchTacoFoods(texts: string[], ask: AskJson = generateAiJson): Promise<(number | null)[]> {
  const unique: { text: string; options: { id: number; name: string }[] }[] = [];
  const indexOf = new Map<string, number>();
  for (const text of texts) {
    if (!text || indexOf.has(text) || unique.length >= MAX_MATCH_TEXTS) continue;
    const options = foodCandidates(text, OPTIONS_PER_TEXT).map((food) => ({ id: food.id, name: food.name }));
    if (!options.length) continue;
    indexOf.set(text, unique.length);
    unique.push({ text, options });
  }
  if (!unique.length) return texts.map(() => null);

  const choices: (number | null)[] = unique.map(() => null);
  try {
    const answer = await ask({
      system: TACO_MATCH_PROMPT,
      prompt: unique.map((entry, i) => `${i}. "${entry.text}" → opções: ${entry.options.map((o) => `${o.id} ${o.name}`).join('; ')}`).join('\n'),
      maxTokens: 1500,
    });
    for (const raw of Array.isArray(answer.escolhas) ? answer.escolhas : []) {
      const pick = raw as { i?: unknown; taco?: unknown };
      if (typeof pick?.i !== 'number' || !unique[pick.i]) continue;
      // Só vale um número que estava entre as opções daquele texto: a IA não inventa alimento.
      if (typeof pick.taco === 'number' && unique[pick.i].options.some((o) => o.id === pick.taco)) choices[pick.i] = pick.taco;
    }
  } catch {
    // Falha da IA aqui já gera aviso lá dentro; quem chamou segue sem os alimentos da TACO.
    return texts.map(() => null);
  }
  return texts.map((text) => (indexOf.has(text) ? choices[indexOf.get(text) as number] : null));
}
