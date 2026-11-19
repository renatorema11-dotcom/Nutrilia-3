import { getAdminDb, json, verifyAccount } from '@/lib/firebase-admin';
import { allowRequest } from '@/lib/ai-guard';
import { submitApproval } from '@/lib/nutritionist-approval';
import { reportServerError } from '@/lib/server-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Nutricionista com cadastro em análise envia (ou corrige) o CRN, a especialidade e o telefone.
 * O servidor confere o formato do CRN, registra o pedido e avisa o responsável pelo NutriAli por e-mail.
 */
export async function POST(req: Request) {
  const account = await verifyAccount(req);
  if (!account) return json({ error: 'Entre novamente no aplicativo.' }, 401);
  if (!allowRequest(`approval:${account.uid}`, 8)) {
    return json({ error: 'Muitos pedidos em pouco tempo. Aguarde alguns minutos e tente de novo.' }, 429);
  }
  let body: unknown = {};
  try {
    const text = await req.text();
    if (text.length > 4000) return json({ error: 'Dados inválidos.' }, 413);
    body = text ? JSON.parse(text) : {};
  } catch {
    return json({ error: 'Dados inválidos.' }, 400);
  }
  try {
    const result = await submitApproval(getAdminDb(), account.uid, body);
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ approval: result.approval, crn: result.crn, notified: result.notified });
  } catch (error) {
    reportServerError('Aprovação: falha ao registrar o pedido.', error);
    return json({ error: 'Não foi possível registrar o seu cadastro agora. Tente de novo em instantes.' }, 503);
  }
}
