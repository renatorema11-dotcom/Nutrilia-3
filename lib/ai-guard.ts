// Proteção das rotas de IA: só usuário logado, do perfil certo, com limite de uso por pessoa e de tamanho do pedido.
import { json, verifyCaller } from './firebase-admin';
import type { Caller } from './firebase-admin';

const GUARD_WINDOW_MS = 10 * 60_000;
const recentRequests = new Map<string, number[]>();

/** Limite por pessoa numa janela de 10 minutos. Fica na memória do servidor: basta para conter abuso. */
export function allowRequest(key: string, limit: number, now = Date.now()): boolean {
  const recent = (recentRequests.get(key) || []).filter((at) => now - at < GUARD_WINDOW_MS);
  if (recent.length >= limit) {
    recentRequests.set(key, recent);
    return false;
  }
  recent.push(now);
  recentRequests.set(key, recent);
  // Não deixa a lista crescer sem fim com chaves que pararam de pedir.
  if (recentRequests.size > 5000) {
    for (const [other, list] of recentRequests) {
      if (!list.some((at) => now - at < GUARD_WINDOW_MS)) recentRequests.delete(other);
    }
  }
  return true;
}

export interface AiGuardOptions {
  roles: Caller['role'][];
  /** Nome da função, para cada uma ter o próprio limite. */
  scope: string;
  /** Pedidos permitidos por pessoa a cada 10 minutos. */
  limit: number;
  /** Tamanho máximo do corpo, em caracteres. */
  maxChars: number;
}

type Guarded = { ok: true; caller: Caller; body: Record<string, unknown> } | { ok: false; response: Response };

/** Confere login, perfil, limite de uso e tamanho, e devolve o corpo já lido. */
export async function guardAi(req: Request, options: AiGuardOptions): Promise<Guarded> {
  const caller = await verifyCaller(req);
  if (!caller) return { ok: false, response: json({ error: 'Entre novamente no aplicativo.' }, 401) };
  if (!options.roles.includes(caller.role)) {
    return { ok: false, response: json({ error: 'Esta função não está disponível para o seu perfil.' }, 403) };
  }
  if (!allowRequest(`${options.scope}:${caller.uid}`, options.limit)) {
    return { ok: false, response: json({ error: 'Muitos pedidos em pouco tempo. Aguarde alguns minutos e tente de novo.' }, 429) };
  }
  let text: string;
  try { text = await req.text(); } catch { return { ok: false, response: json({ error: 'Dados inválidos.' }, 400) }; }
  if (text.length > options.maxChars) return { ok: false, response: json({ error: 'O pedido ficou grande demais.' }, 413) };
  let body: unknown;
  try { body = JSON.parse(text); } catch { return { ok: false, response: json({ error: 'Dados inválidos.' }, 400) }; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, response: json({ error: 'Dados inválidos.' }, 400) };
  return { ok: true, caller, body: body as Record<string, unknown> };
}

/** Texto vindo do navegador, com tamanho limitado antes de entrar no pedido à IA. */
export function clip(value: unknown, max: number): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' ? value.slice(0, max) : '';
}

/** Última mensagem do usuário numa lista de mensagens de chat. */
export function lastMessage(messages: unknown, max: number): string {
  if (!Array.isArray(messages) || !messages.length) return '';
  const last = messages[messages.length - 1];
  return last && typeof last === 'object' ? clip((last as Record<string, unknown>).text, max) : '';
}

const IMAGE_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

/** Foto enviada como data URL: só JPEG, PNG ou WebP. Devolve null se não for uma imagem aceita. */
export function parseImage(value: unknown): { mimeType: string; data: string } | null {
  if (typeof value !== 'string') return null;
  const match = IMAGE_RE.exec(value);
  return match ? { mimeType: match[1], data: match[2] } : null;
}
