import { getAdminDb, json, verifyAccount, type Account } from '@/lib/firebase-admin';
import { allowRequest } from '@/lib/ai-guard';
import { AsaasError, asaasConfigured } from '@/lib/asaas-client';
import { createSubaccount, linkWallet, nutritionistFinance, savePrice } from '@/lib/consultation-payments';
import { reportServerError } from '@/lib/server-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Só nutricionista com cadastro aprovado. Devolve a recusa, ou null. */
function refuse(account: Account | null): Response | null {
  if (!account) return json({ error: 'Entre novamente no aplicativo.' }, 401);
  const approval = account.profile?.approval;
  if (account.profile?.role !== 'nutritionist' || approval === 'pending' || approval === 'rejected') {
    return json({ error: 'Esta área é das nutricionistas com cadastro aprovado.' }, 403);
  }
  return null;
}

/** Painel "Financeiro": preço, conta para receber, cobranças e totais. */
export async function GET(req: Request) {
  const account = await verifyAccount(req);
  const refused = refuse(account);
  if (refused || !account) return refused as Response;
  try {
    return json({ ...(await nutritionistFinance(getAdminDb(), account.uid)), configured: asaasConfigured() });
  } catch (error) {
    reportServerError('Financeiro: falha ao carregar o painel.', error);
    return json({ error: 'Não foi possível carregar agora. Tente de novo em instantes.' }, 503);
  }
}

/** { action: 'preco', price } | { action: 'carteira', walletId } | { action: 'conta', ...dados da subconta } */
export async function POST(req: Request) {
  const account = await verifyAccount(req);
  const refused = refuse(account);
  if (refused || !account) return refused as Response;
  if (!allowRequest(`payments-nutri:${account.uid}`, 20)) return json({ error: 'Muitos pedidos em pouco tempo. Aguarde alguns minutos.' }, 429);
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse((await req.text()).slice(0, 4000));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ error: 'Dados inválidos.' }, 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'Dados inválidos.' }, 400);
  }
  try {
    const db = getAdminDb();
    if (body.action === 'preco') {
      const result = await savePrice(db, account.uid, body.price);
      return result.ok ? json({ price: result.price }) : json({ error: result.error }, result.status);
    }
    if (body.action === 'carteira') {
      const result = await linkWallet(db, account.uid, body.walletId);
      return result.ok ? json({ ok: true }) : json({ error: result.error }, result.status);
    }
    if (body.action === 'conta') {
      if (!asaasConfigured()) return json({ error: 'O pagamento pelo app ainda está sendo configurado. Tente de novo mais tarde.' }, 503);
      const name = String(account.profile?.displayName || account.profile?.name || '').trim() || account.email;
      const result = await createSubaccount(db, account.uid, { name, email: account.email }, body);
      return result.ok ? json({ ok: true }) : json({ error: result.error }, result.status);
    }
    return json({ error: 'Dados inválidos.' }, 400);
  } catch (error) {
    // Recusa do Asaas por causa dos dados (ex.: CEP que ele não encontra) volta para a pessoa corrigir.
    if (error instanceof AsaasError && error.status === 400) return json({ error: error.message }, 422);
    reportServerError('Financeiro: falha ao salvar.', error);
    return json({ error: 'Não foi possível salvar agora. Tente de novo em instantes.' }, 503);
  }
}
