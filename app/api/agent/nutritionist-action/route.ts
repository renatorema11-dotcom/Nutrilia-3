import { getAuth } from 'firebase-admin/auth';
import { after } from 'next/server';
import type { App } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';
import { getAdminApp, getAdminDb, hasGatewaySecret, json, lastSeenLookup } from '@/lib/firebase-admin';
import { approvalOf } from '@/lib/nutritionist-approval';
import { generatePlanDraft } from '@/lib/plan-draft';
import { findAction, runNutritionistAction } from '@/lib/nutritionist-actions';
import { reportServerError } from '@/lib/server-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Ações da Ali da nutricionista pelo webhook (ElevenLabs → n8n → aqui): segredo do gateway + ID token Firebase de uma
// conta de nutricionista aprovada. A lista de ações, o que só lê e o que grava ficam em lib/nutritionist-actions.ts,
// a mesma lista do servidor MCP (/api/mcp). Ação que grava ou envia exige confirmed === true.

function reply(ok: boolean, speech: string, status = 200, extra: Record<string, unknown> = {}) {
  return json({ ok, speech, ...extra }, status);
}

async function audit(db: Firestore, nutritionistId: string, action: string, result: 'completed' | 'failed' = 'completed') {
  try {
    // Só o que foi feito e por quem: o conteúdo de e-mails, recados e compromissos não entra no registro.
    await db.collection('aiActions').add({ nutritionistId, patientUid: null, actor: 'nutritionist', action, result, createdAt: new Date().toISOString() });
  } catch (error) {
    reportServerError('Ali da nutricionista: falha ao registrar auditoria.', error);
  }
}

export async function POST(req: Request) {
  if (!hasGatewaySecret(req)) return reply(false, 'Não autorizado.', 401);
  const token = req.headers.get('x-nutritionist-token');
  if (!token || token.length > 8192) return reply(false, 'Entre novamente no aplicativo.', 401);
  let adminApp: App;
  try { adminApp = getAdminApp(); }
  catch { return reply(false, 'A integração ainda não está configurada.', 503); }
  let uid: string;
  try {
    const decoded = await getAuth(adminApp).verifyIdToken(token, true);
    if (decoded.firebase?.sign_in_provider === 'anonymous') return reply(false, 'Entre com a sua conta de nutricionista.', 403);
    uid = decoded.uid;
  } catch { return reply(false, 'Sua sessão expirou ou não é válida. Entre novamente.', 401); }

  let body: unknown;
  try { body = await req.json(); } catch { return reply(false, 'Corpo da requisição inválido.', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(false, 'Corpo inválido.', 400);
  const { action, confirmed, payload: rawPayload } = body as Record<string, unknown>;
  if (rawPayload !== undefined && rawPayload !== null && (typeof rawPayload !== 'object' || Array.isArray(rawPayload))) {
    return reply(false, 'Dados da ação inválidos.', 400);
  }
  const payload = (rawPayload || {}) as Record<string, unknown>;
  const def = findAction(action);
  if (!def) return reply(false, 'Ação não reconhecida.', 400);
  if (def.kind === 'write' && confirmed !== true) return reply(false, 'Confirme com a nutricionista antes de executar esta ação.', 422);

  try {
    const db = getAdminDb();
    // O papel vem do perfil salvo no servidor: paciente nunca usa estas ações, nem nutricionista ainda em análise.
    const profile = await db.collection('users').doc(uid).get();
    if (!profile.exists || profile.data()?.role !== 'nutritionist') return reply(false, 'Esta assistente é só para nutricionistas.', 403);
    if (approvalOf(profile.data()) !== 'approved') return reply(false, 'O seu cadastro de nutricionista ainda não foi aprovado.', 403);

    // A IA do rascunho leva até um minuto: ele é montado depois da resposta, para a voz não ficar esperando.
    const result = await runNutritionistAction({ db, uid, lastSeen: lastSeenLookup, generatePlan: generatePlanDraft, runLater: (task) => after(task) }, def.name, payload, confirmed);
    if (!result.ok) return reply(false, result.speech, result.status);
    await audit(db, uid, def.name);
    const extra = Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'ok' && key !== 'speech'));
    return reply(true, result.speech, 200, extra);
  } catch (error) {
    reportServerError('Ali da nutricionista: ação indisponível.', error);
    // Falhas inesperadas entram na contagem do relatório de uso.
    try { await audit(getAdminDb(), uid, def.name, 'failed'); } catch { /* o banco pode ser justamente o que falhou */ }
    return reply(false, 'Não consegui fazer isso agora. Tente de novo em instantes.', 500);
  }
}
