import { getAuth } from 'firebase-admin/auth';
import { getAdminApp, getAdminDb, json, verifyAccount, type Account } from '@/lib/firebase-admin';
import { allowRequest } from '@/lib/ai-guard';
import { adminEmails, isAdmin } from '@/lib/nutritionist-approval';
import { decideDeletion, listDeletionRequests } from '@/lib/account-privacy';
import { reportServerError } from '@/lib/server-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Só o responsável pelo NutriAli (e-mail em ADMIN_EMAILS, confirmado) passa. Devolve a resposta de recusa, ou null. */
function refuse(account: Account | null): Response | null {
  if (!account) return json({ error: 'Entre novamente no aplicativo.' }, 401);
  if (isAdmin(account.email, account.emailVerified)) return null;
  if (adminEmails().includes(account.email.toLowerCase())) {
    return json({ error: 'Para ver os pedidos de exclusão, entre com o botão "Entrar com o Google" usando este mesmo e-mail.' }, 403);
  }
  return json({ error: 'Esta área é só do responsável pelo NutriAli.' }, 403);
}

/** Lista os pedidos de exclusão. Com "?resumo=1", só diz se a conta é responsável e quantos pedidos esperam. */
export async function GET(req: Request) {
  const account = await verifyAccount(req);
  if (account && new URL(req.url).searchParams.has('resumo')) {
    if (!isAdmin(account.email, account.emailVerified)) return json({ admin: false, pending: 0 });
    try {
      const rows = await listDeletionRequests(getAdminDb());
      return json({ admin: true, pending: rows.filter((row) => row.status === 'pending').length });
    } catch {
      return json({ admin: true, pending: 0 });
    }
  }
  const refused = refuse(account);
  if (refused) return refused;
  try {
    return json({ deletions: await listDeletionRequests(getAdminDb()) });
  } catch (error) {
    reportServerError('Exclusão: falha ao listar os pedidos.', error);
    return json({ error: 'Não foi possível carregar os pedidos agora.' }, 503);
  }
}

/** Decide um pedido: { uid, decision: 'delete' | 'keep' }. Apagar é definitivo. */
export async function POST(req: Request) {
  const account = await verifyAccount(req);
  const refused = refuse(account);
  if (refused || !account) return refused as Response;
  if (!allowRequest(`deletion-admin:${account.uid}`, 30)) return json({ error: 'Muitos pedidos em pouco tempo. Aguarde alguns minutos.' }, 429);
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse((await req.text()).slice(0, 2000));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ error: 'Dados inválidos.' }, 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'Dados inválidos.' }, 400);
  }
  try {
    const result = await decideDeletion(getAdminDb(), account.email, body.uid, body.decision, async (uid) => {
      try {
        await getAuth(getAdminApp()).deleteUser(uid);
      } catch (error) {
        // Login que já não existe não impede a exclusão dos dados.
        if ((error as { code?: string })?.code !== 'auth/user-not-found') throw error;
      }
    });
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ status: result.status });
  } catch (error) {
    reportServerError('Exclusão: falha ao decidir o pedido.', error);
    // Se parou no meio, repetir termina o serviço: o que já foi apagado é simplesmente pulado.
    return json({ error: 'Não foi possível concluir agora. Tente de novo em instantes.' }, 503);
  }
}
