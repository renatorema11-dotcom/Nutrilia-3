import { getAdminDb, json, verifyAccount, type Account } from '@/lib/firebase-admin';
import { allowRequest } from '@/lib/ai-guard';
import { adminEmails, isAdmin } from '@/lib/nutritionist-approval';
import { grantCourtesy } from '@/lib/premium-access';
import { reportServerError } from '@/lib/server-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Só o responsável pelo NutriAli (e-mail em ADMIN_EMAILS, confirmado) passa. Devolve a resposta de recusa, ou null. */
function refuse(account: Account | null): Response | null {
  if (!account) return json({ error: 'Entre novamente no aplicativo.' }, 401);
  if (isAdmin(account.email, account.emailVerified)) return null;
  if (adminEmails().includes(account.email.toLowerCase())) {
    return json({ error: 'Para dar Premium de cortesia, entre com o botão "Entrar com o Google" usando este mesmo e-mail.' }, 403);
  }
  return json({ error: 'Esta área é só do responsável pelo NutriAli.' }, 403);
}

/** { email, days } dá Premium de cortesia ao paciente por alguns dias; days 0 tira a cortesia. */
export async function POST(req: Request) {
  const account = await verifyAccount(req);
  const refused = refuse(account);
  if (refused || !account) return refused as Response;
  if (!allowRequest(`premium-admin:${account.uid}`, 30)) return json({ error: 'Muitos pedidos em pouco tempo. Aguarde alguns minutos.' }, 429);
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse((await req.text()).slice(0, 2000));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ error: 'Dados inválidos.' }, 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'Dados inválidos.' }, 400);
  }
  try {
    const result = await grantCourtesy(getAdminDb(), body.email, body.days);
    return result.ok ? json({ name: result.name, until: result.until }) : json({ error: result.error }, result.status);
  } catch (error) {
    reportServerError('Premium: falha ao dar a cortesia.', error);
    return json({ error: 'Não foi possível salvar agora. Tente de novo em instantes.' }, 503);
  }
}
