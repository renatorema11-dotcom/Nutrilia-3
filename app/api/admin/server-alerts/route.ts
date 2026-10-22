import { getAdminDb, json, verifyAccount, type Account } from '@/lib/firebase-admin';
import { allowRequest } from '@/lib/ai-guard';
import { adminEmails, isAdmin } from '@/lib/nutritionist-approval';
import { alertEmailStatus, listServerAlerts, resolveServerAlert, sendTestAlert } from '@/lib/server-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Só o responsável pelo NutriAli (e-mail em ADMIN_EMAILS, confirmado) passa. Devolve a resposta de recusa, ou null. */
function refuse(account: Account | null): Response | null {
  if (!account) return json({ error: 'Entre novamente no aplicativo.' }, 401);
  if (isAdmin(account.email, account.emailVerified)) return null;
  if (adminEmails().includes(account.email.toLowerCase())) {
    return json({ error: 'Para ver os erros do servidor, entre com o botão "Entrar com o Google" usando este mesmo e-mail.' }, 403);
  }
  return json({ error: 'Esta área é só do responsável pelo NutriAli.' }, 403);
}

/** Lista os erros registrados e diz se os avisos por e-mail têm por onde sair. */
export async function GET(req: Request) {
  const refused = refuse(await verifyAccount(req));
  if (refused) return refused;
  try {
    const db = getAdminDb();
    const [alerts, email] = await Promise.all([listServerAlerts(db), alertEmailStatus(db)]);
    return json({ alerts, email });
  } catch {
    // Sem aviso por e-mail aqui: se o banco estiver fora, a própria lista é o que falhou.
    console.error('Erros do servidor: falha ao listar.');
    return json({ error: 'Não foi possível carregar a lista agora.' }, 503);
  }
}

/** { action: 'test' } manda um e-mail de teste; { action: 'resolve', id } marca um erro como resolvido. */
export async function POST(req: Request) {
  const account = await verifyAccount(req);
  const refused = refuse(account);
  if (refused || !account) return refused as Response;
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse((await req.text()).slice(0, 2000));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ error: 'Dados inválidos.' }, 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'Dados inválidos.' }, 400);
  }
  if (body.action !== 'test' && body.action !== 'resolve') return json({ error: 'Pedido não reconhecido.' }, 400);
  // O teste manda e-mail de verdade: poucas vezes por pessoa a cada 10 minutos.
  if (!allowRequest(`server-alerts-${body.action}:${account.uid}`, body.action === 'test' ? 3 : 60)) {
    return json({ error: 'Muitos pedidos em pouco tempo. Aguarde alguns minutos.' }, 429);
  }
  try {
    const db = getAdminDb();
    const result = body.action === 'test' ? await sendTestAlert(db) : await resolveServerAlert(db, body.id);
    if (!result.ok) return json({ error: result.error }, result.status);
    return json(result);
  } catch {
    console.error('Erros do servidor: falha ao concluir o pedido.');
    return json({ error: 'Não foi possível concluir agora. Tente de novo em instantes.' }, 503);
  }
}
