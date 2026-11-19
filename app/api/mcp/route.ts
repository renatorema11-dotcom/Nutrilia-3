import { createHash, timingSafeEqual } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { after } from 'next/server';
import type { App } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';
import { getAdminApp, getAdminDb, lastSeenLookup } from '@/lib/firebase-admin';
import { approvalOf } from '@/lib/nutritionist-approval';
import { allowRequest } from '@/lib/ai-guard';
import { generatePlanDraft } from '@/lib/plan-draft';
import { MCP_PROTOCOL_VERSIONS, handleMcpPayload } from '@/lib/mcp-protocol';
import { buildMcpHost } from '@/lib/mcp-nutriali';
import type { McpAudit } from '@/lib/mcp-nutriali';
import type { ActionContext } from '@/lib/nutritionist-actions';
import { reportServerError } from '@/lib/server-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Servidor MCP do NutriAli: o "segundo cérebro" da Ali da nutricionista (protocolo MCP, transporte Streamable HTTP,
 * sem sessão e só com respostas em JSON). Duas chaves, como no webhook da Ali:
 *  1. o segredo do servidor (MCP_SERVER_SECRET), no cabeçalho x-mcp-secret ou em Authorization (com ou sem "Bearer "): prova
 *     que quem chama é um cliente autorizado pelo NutriAli (a ElevenLabs, por exemplo). Sem a variável, o MCP fica desligado;
 *  2. o login da nutricionista (ID token do Firebase), no cabeçalho x-nutritionist-token: diz de quem são os dados.
 * Só com o segredo dá para listar o que existe; executar ferramenta ou ler recurso exige as duas.
 */
const MCP_MAX_BODY = 64 * 1024;
/** Navegador só chama a partir do próprio app; clientes de servidor (ElevenLabs, n8n) não mandam Origin. */
const MCP_ORIGINS = ['https://app.nutriali.cloud'];
/** Pedidos por nutricionista a cada 10 minutos (uma conversa longa por voz fica bem abaixo disso). */
const MCP_USER_LIMIT = 240;
const MCP_LIST_LIMIT = 600;
/** Ferramentas e leituras por nutricionista a cada 10 minutos, contadas uma a uma. */
const MCP_CALL_LIMIT = 120;

function mcpReply(status: number, body: unknown | null, headers: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...(body === null ? {} : { 'content-type': 'application/json' }), 'cache-control': 'no-store', ...headers },
  });
}

const mcpRefuse = (status: number, code: number, message: string, headers: Record<string, string> = {}) =>
  mcpReply(status, { jsonrpc: '2.0', id: null, error: { code, message } }, headers);

/** Confere o segredo do servidor. 'unset' = a variável não está configurada (MCP desligado). */
function mcpSecret(req: Request): 'unset' | boolean {
  const expected = process.env.MCP_SERVER_SECRET;
  if (!expected || expected.length < 32) return 'unset';
  // A ElevenLabs manda o "Secret Token" no Authorization, e a documentação não diz se com "Bearer " na frente: vale dos dois jeitos.
  const header = (req.headers.get('authorization') || '').trim();
  const provided = (req.headers.get('x-mcp-secret') || '').trim() || header.replace(/^bearer\s+/i, '').trim();
  if (!provided || provided.length > 4096) return false;
  // Compara os resumos: tamanho fixo, sem revelar o tamanho do segredo pelo tempo de resposta.
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

function mcpOriginAllowed(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try { return MCP_ORIGINS.includes(origin) || origin === new URL(req.url).origin; } catch { return false; }
}

type McpCaller = { ok: true; uid: string } | { ok: false; reason: 'none' | 'invalid' | 'forbidden' | 'unavailable' };

/** A nutricionista do pedido: login válido, papel de nutricionista e cadastro aprovado (as mesmas regras do webhook da Ali). */
async function mcpCaller(req: Request): Promise<McpCaller> {
  const token = req.headers.get('x-nutritionist-token');
  if (!token) return { ok: false, reason: 'none' };
  if (token.length > 8192) return { ok: false, reason: 'invalid' };
  let adminApp: App;
  try { adminApp = getAdminApp(); } catch { return { ok: false, reason: 'unavailable' }; }
  let uid: string;
  try {
    const decoded = await getAuth(adminApp).verifyIdToken(token, true);
    if (decoded.firebase?.sign_in_provider === 'anonymous') return { ok: false, reason: 'forbidden' };
    uid = decoded.uid;
  } catch { return { ok: false, reason: 'invalid' }; }
  try {
    // O papel vem do perfil salvo no servidor: paciente nunca usa o MCP, nem nutricionista ainda em análise.
    const profile = await getAdminDb().collection('users').doc(uid).get();
    if (!profile.exists || profile.data()?.role !== 'nutritionist' || approvalOf(profile.data()) !== 'approved') return { ok: false, reason: 'forbidden' };
  } catch (error) {
    reportServerError('MCP: não foi possível ler o perfil da nutricionista.', error);
    return { ok: false, reason: 'unavailable' };
  }
  return { ok: true, uid };
}

/** Só o que foi feito e por quem: o conteúdo (nomes, textos, números) nunca entra no registro. */
async function mcpAudit(db: Firestore, nutritionistId: string, action: string, result: 'completed' | 'failed') {
  try {
    await db.collection('aiActions').add({ nutritionistId, patientUid: null, actor: 'nutritionist', action: action.slice(0, 60), result, channel: 'mcp', createdAt: new Date().toISOString() });
  } catch (error) {
    reportServerError('MCP: falha ao registrar auditoria.', error);
  }
}

export async function POST(req: Request) {
  const secret = mcpSecret(req);
  if (secret === 'unset') return mcpRefuse(503, -32603, 'MCP server is not configured.');
  if (!secret) return mcpRefuse(401, -32001, 'Unauthorized.');
  if (!mcpOriginAllowed(req)) return mcpRefuse(403, -32001, 'Origin not allowed.');
  const version = req.headers.get('mcp-protocol-version');
  if (version && !MCP_PROTOCOL_VERSIONS.includes(version)) return mcpRefuse(400, -32600, 'Unsupported MCP-Protocol-Version.');

  const caller = await mcpCaller(req);
  // Banco fora do ar: a conexão continua (listar não depende dele) e cada ferramenta responde "tente de novo".
  const unavailable = !caller.ok && caller.reason === 'unavailable';
  if (!allowRequest(caller.ok ? `mcp:${caller.uid}` : 'mcp:lista', caller.ok ? MCP_USER_LIMIT : MCP_LIST_LIMIT)) return mcpRefuse(429, -32000, 'Too many requests. Try again in a few minutes.');

  let payload: unknown;
  try {
    const text = await req.text();
    if (text.length > MCP_MAX_BODY) return mcpRefuse(413, -32600, 'Request too large.');
    payload = JSON.parse(text);
  } catch {
    payload = undefined; // JSON inválido: o protocolo responde com o erro de leitura (-32700).
  }

  try {
    let ctx: ActionContext | null = null;
    let audit: McpAudit = async () => {};
    let allowCall: (() => boolean) | undefined;
    if (caller.ok) {
      const db = getAdminDb();
      const uid = caller.uid;
      ctx = { db, uid, lastSeen: lastSeenLookup, generatePlan: generatePlanDraft, runLater: (task) => after(task) };
      allowCall = () => allowRequest(`mcp-call:${uid}`, MCP_CALL_LIMIT);
      audit = async (action, result, error) => {
        if (result === 'failed') reportServerError('MCP: ação indisponível.', error);
        await mcpAudit(db, uid, action, result);
      };
    }
    const out = await handleMcpPayload(payload, buildMcpHost(ctx, audit, { unavailable, allowCall }));
    return mcpReply(out.status, out.body);
  } catch (error) {
    reportServerError('MCP: pedido não atendido.', error);
    return mcpRefuse(500, -32603, 'Internal error.');
  }
}

/** Este servidor não abre fluxo de eventos (SSE) nem guarda sessão: só POST. */
export function GET() {
  return mcpRefuse(405, -32600, 'Method not allowed. Use POST.', { allow: 'POST' });
}

export function DELETE() {
  return mcpRefuse(405, -32600, 'Method not allowed. Use POST.', { allow: 'POST' });
}
