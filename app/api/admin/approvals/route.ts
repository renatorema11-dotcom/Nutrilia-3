import { getAdminDb, json, verifyAccount, type Account } from '@/lib/firebase-admin';
import { allowRequest } from '@/lib/ai-guard';
import { adminEmails, decideApproval, isAdmin, listApprovals } from '@/lib/nutritionist-approval';
import { reportServerError } from '@/lib/server-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Só o responsável pelo NutriAli (e-mail em ADMIN_EMAILS, confirmado) passa. Devolve a resposta de recusa, ou null. */
function refuse(account: Account | null): Response | null {
  if (!account) return json({ error: 'Entre novamente no aplicativo.' }, 401);
  if (isAdmin(account.email, account.emailVerified)) return null;
  // O e-mail é da lista, mas a conta não provou que ele é da pessoa (cadastro por senha sem confirmação).
  if (adminEmails().includes(account.email.toLowerCase())) {
    return json({ error: 'Para aprovar cadastros, entre com o botão "Entrar com o Google" usando este mesmo e-mail.' }, 403);
  }
  return json({ error: 'Esta área é só do responsável pelo NutriAli.' }, 403);
}

/**
 * Lista os cadastros de nutricionista: os que aguardam aprovação e os decididos mais recentes.
 * Com "?resumo=1" responde a qualquer conta logada só se ela é responsável e quantos cadastros esperam
 * (o menu usa isso para mostrar o item "Aprovações" sem gerar erro para quem não é responsável).
 */
export async function GET(req: Request) {
  const account = await verifyAccount(req);
  if (account && new URL(req.url).searchParams.has('resumo')) {
    if (!isAdmin(account.email, account.emailVerified)) return json({ admin: false, pending: 0 });
    try {
      const approvals = await listApprovals(getAdminDb());
      return json({ admin: true, pending: approvals.filter((item) => item.approval === 'pending').length });
    } catch {
      return json({ admin: true, pending: 0 });
    }
  }
  const refused = refuse(account);
  if (refused) return refused;
  try {
    return json({ approvals: await listApprovals(getAdminDb()) });
  } catch (error) {
    reportServerError('Aprovação: falha ao listar os cadastros.', error);
    return json({ error: 'Não foi possível carregar os cadastros agora.' }, 503);
  }
}

/** Aprova ou recusa um cadastro: { uid, decision: 'approve' | 'reject' }. */
export async function POST(req: Request) {
  const account = await verifyAccount(req);
  const refused = refuse(account);
  if (refused || !account) return refused as Response;
  if (!allowRequest(`approval-admin:${account.uid}`, 60)) {
    return json({ error: 'Muitos pedidos em pouco tempo. Aguarde alguns minutos e tente de novo.' }, 429);
  }
  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text.length > 2000) return json({ error: 'Dados inválidos.' }, 413);
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ error: 'Dados inválidos.' }, 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'Dados inválidos.' }, 400);
  }
  try {
    const result = await decideApproval(getAdminDb(), account.email, body.uid, body.decision);
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ approval: result.approval, emailed: result.emailed });
  } catch (error) {
    reportServerError('Aprovação: falha ao registrar a decisão.', error);
    return json({ error: 'Não foi possível registrar a decisão agora. Tente de novo em instantes.' }, 503);
  }
}
