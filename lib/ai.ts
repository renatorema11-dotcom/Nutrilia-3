// Camada única de IA do app. Usa a Groq quando GROQ_API_KEY está configurada no servidor;
// sem ela, usa o Gemini se houver GEMINI_API_KEY. Quando a IA falha, quem chamou recebe um aviso claro:
// nunca um texto pronto que pareça resposta de verdade.
import { json } from './firebase-admin';
import { generateWithGemini } from './gemini';
import { notifyServerError } from './server-alerts';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Os modelos da Groq mudam com frequência: GROQ_MODEL e GROQ_VISION_MODEL trocam o modelo sem mexer no código.
const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
const DEFAULT_GROQ_VISION_MODEL = 'qwen/qwen3.8-27b';
const AI_TIMEOUT_MS = 45_000;

const AI_MESSAGES = {
  unavailable: 'A inteligência artificial está indisponível no momento. Tente de novo em alguns minutos.',
  busy: 'A inteligência artificial atingiu o limite de uso por agora. Aguarde um minuto e tente de novo.',
  tooLarge: 'O pedido ficou grande demais para a inteligência artificial. Tente com menos texto ou uma foto menor.',
  invalid: 'A inteligência artificial respondeu de um jeito que não deu para aproveitar. Tente de novo.',
};

/** Falha da IA já com a mensagem que pode ser mostrada à pessoa e o código HTTP da resposta. */
export class AiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AiError';
    this.status = status;
  }
}

export interface AiImage { mimeType: string; data: string }
export interface AiTurn { role: 'user' | 'assistant'; text: string }

export interface AiRequest {
  /** Papel e regras da IA nesta função. */
  system?: string;
  /** Falas anteriores da conversa, da mais antiga para a mais nova, para a IA lembrar do que já foi dito. */
  history?: AiTurn[];
  prompt: string;
  /** Foto em base64 (JPEG, PNG ou WebP), já validada. */
  image?: AiImage | null;
  /** Tamanho máximo da resposta, em tokens. */
  maxTokens?: number;
}

/** Tira o raciocínio que alguns modelos devolvem junto (<think>…</think>) e os espaços das pontas. */
export function cleanAnswer(content: unknown): string {
  if (typeof content !== 'string') return '';
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*<\/think>/, '').trim();
}

/** Acha o objeto JSON dentro da resposta, mesmo que venha entre crases ou com texto em volta. */
export function extractJson(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed: unknown = JSON.parse(text.slice(start, end + 1));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // cai no erro abaixo
    }
  }
  throw new AiError(AI_MESSAGES.invalid, 502);
}

// Modelos que "pensam" antes de responder: pensar pouco poupa o limite gratuito, e o raciocínio não vai para a pessoa.
function reasoningOptions(model: string): Record<string, unknown> {
  if (model.startsWith('openai/gpt-oss')) return { reasoning_effort: 'low', include_reasoning: false };
  if (model.startsWith('qwen/')) return { reasoning_effort: 'none', reasoning_format: 'hidden' };
  return {};
}

function postGroq(body: Record<string, unknown>, apiKey: string): Promise<Response> {
  return fetch(GROQ_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(AI_TIMEOUT_MS),
  });
}

async function providerMessage(response: Response): Promise<string> {
  try {
    const data = await response.json();
    return String(data?.error?.message || '').slice(0, 300);
  } catch {
    return '';
  }
}

async function callGroq(request: AiRequest, apiKey: string): Promise<string> {
  const model = request.image
    ? process.env.GROQ_VISION_MODEL || DEFAULT_GROQ_VISION_MODEL
    : process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL;
  // Com foto, as regras vão junto do pedido: nem todo modelo de imagem aceita mensagem de sistema.
  const messages = request.image
    ? [{
        role: 'user',
        content: [
          { type: 'text', text: request.system ? `${request.system}\n\n${request.prompt}` : request.prompt },
          { type: 'image_url', image_url: { url: `data:${request.image.mimeType};base64,${request.image.data}` } },
        ],
      }]
    : [
        ...(request.system ? [{ role: 'system', content: request.system }] : []),
        ...(request.history || []).map((turn) => ({ role: turn.role, content: turn.text })),
        { role: 'user', content: request.prompt },
      ];
  const basic = { model, messages, temperature: 0.6, max_completion_tokens: request.maxTokens || 1200 };
  const extras = reasoningOptions(model);

  let response = await postGroq({ ...basic, ...extras }, apiKey);
  if (response.status === 400 && Object.keys(extras).length) {
    // A Groq recusou o formato do pedido: repete só com o básico, sem as opções de raciocínio.
    response = await postGroq(basic, apiKey);
  } else if (response.status >= 500) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    response = await postGroq({ ...basic, ...extras }, apiKey);
  }

  if (!response.ok) {
    console.warn(`IA (Groq) recusou o pedido: ${response.status} no modelo ${model}. ${await providerMessage(response)}`);
    if (response.status === 429) {
      notifyServerError('IA: limite de uso do serviço de IA atingido.', { status: 429 });
      throw new AiError(AI_MESSAGES.busy, 429);
    }
    // Foto grande demais é do pedido, não do servidor: não vira aviso.
    if (response.status === 413) throw new AiError(AI_MESSAGES.tooLarge, 413);
    // O código diz o motivo (401: chave recusada, 5xx: Groq fora do ar).
    notifyServerError('IA: o serviço de IA recusou o pedido.', { status: response.status });
    throw new AiError(AI_MESSAGES.unavailable, 503);
  }
  const data = await response.json();
  const answer = cleanAnswer(data?.choices?.[0]?.message?.content);
  if (!answer) {
    console.warn(`IA (Groq) devolveu resposta vazia no modelo ${model}.`);
    throw new AiError(AI_MESSAGES.unavailable, 503);
  }
  return answer;
}

/** Pede um texto à IA. Lança AiError quando não há IA configurada ou quando ela falha. */
export async function generateAi(request: AiRequest): Promise<string> {
  const groqKey = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!groqKey && !geminiKey) {
    console.warn('IA sem chave no servidor: configure GROQ_API_KEY (ou GEMINI_API_KEY).');
    notifyServerError('IA: o servidor está sem chave de IA configurada.');
    throw new AiError(AI_MESSAGES.unavailable, 503);
  }
  try {
    const answer = groqKey ? await callGroq(request, groqKey) : cleanAnswer(await generateWithGemini(request, geminiKey as string));
    if (!answer) throw new AiError(AI_MESSAGES.unavailable, 503);
    return answer;
  } catch (error) {
    if (error instanceof AiError) throw error;
    // Rede fora do ar, tempo esgotado ou erro do Gemini: o motivo fica só no registro do servidor.
    const reason = String((error as Error)?.message || error).slice(0, 300);
    console.warn(`IA falhou: ${reason}`);
    if (/429|RESOURCE_EXHAUSTED|quota/i.test(reason)) {
      notifyServerError('IA: limite de uso do serviço de IA atingido.', error);
      throw new AiError(AI_MESSAGES.busy, 429);
    }
    notifyServerError('IA: o serviço de IA não respondeu.', error);
    throw new AiError(AI_MESSAGES.unavailable, 503);
  }
}

/** Pede à IA uma resposta em JSON (o pedido precisa dizer o formato) e devolve o objeto lido. */
export async function generateAiJson(request: AiRequest): Promise<Record<string, unknown>> {
  return extractJson(await generateAi(request));
}

/** Resposta da rota quando a IA falha: aviso claro para a tela, sem inventar conteúdo. */
export function aiErrorResponse(error: unknown, where: string): Response {
  if (error instanceof AiError) return json({ error: error.message }, error.status);
  console.error(`Erro inesperado em ${where}:`, error);
  notifyServerError(`IA: erro inesperado em ${where}.`, error);
  return json({ error: AI_MESSAGES.unavailable }, 503);
}

const shortText = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export interface AiPlanMeal {
  time: string;
  name: string;
  items: string[];
  /** Peso estimado de cada item em gramas, na ordem de items (0 = sem estimativa). Vira "foods" com a TACO. */
  grams?: number[];
  /** Alimento da TACO e peso de cada item (lib/plan-nutrition.ts); null quando não deu para ligar à tabela. */
  foods?: ({ taco: number; grams: number } | null)[];
}
export interface AiPlanDay { name: string; meals: AiPlanMeal[] }

/** Confere o plano devolvido pela IA e guarda só o que tem o formato esperado. Lança AiError se não sobrar nada. */
export function normalizePlan(data: Record<string, unknown>): { days: AiPlanDay[] } {
  const days: AiPlanDay[] = [];
  for (const rawDay of Array.isArray(data.days) ? data.days.slice(0, 7) : []) {
    if (!rawDay || typeof rawDay !== 'object') continue;
    const day = rawDay as Record<string, unknown>;
    const meals: AiPlanMeal[] = [];
    for (const rawMeal of Array.isArray(day.meals) ? day.meals.slice(0, 8) : []) {
      if (!rawMeal || typeof rawMeal !== 'object') continue;
      const meal = rawMeal as Record<string, unknown>;
      // O peso de cada item anda junto com ele: item descartado leva o peso junto.
      const rawGrams = Array.isArray(meal.gramas) ? meal.gramas : Array.isArray(meal.grams) ? meal.grams : [];
      const pairs = (Array.isArray(meal.items) ? meal.items : [])
        .map((item, i) => ({ item: shortText(item, 200), grams: rawGrams[i] }))
        .filter((pair) => pair.item)
        .slice(0, 12);
      const items = pairs.map((pair) => pair.item);
      const grams = pairs.map((pair) => (typeof pair.grams === 'number' && Number.isFinite(pair.grams) && pair.grams > 0 && pair.grams <= 2000 ? Math.round(pair.grams) : 0));
      const name = shortText(meal.name, 80);
      if (name && items.length) meals.push({ time: shortText(meal.time, 10), name, items, ...(grams.some((g) => g > 0) ? { grams } : {}) });
    }
    if (meals.length) days.push({ name: shortText(day.name, 80) || `Dia ${days.length + 1}`, meals });
  }
  if (!days.length) throw new AiError(AI_MESSAGES.invalid, 502);
  return { days };
}

const FEEDBACK_STATUS = ['positive', 'neutral', 'negative', 'corrective'];

/** Confere o retorno da análise de refeição. Lança AiError se não vier um texto de retorno. */
export function normalizeFoodFeedback(data: Record<string, unknown>): { status: string; feedback: string } {
  const feedback = shortText(data.feedback, 1500);
  if (!feedback) throw new AiError(AI_MESSAGES.invalid, 502);
  const status = typeof data.status === 'string' && FEEDBACK_STATUS.includes(data.status) ? data.status : 'neutral';
  return { status, feedback };
}
