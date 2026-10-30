import { getAdminDb, json, verifyAccount } from '@/lib/firebase-admin';
import { allowRequest } from '@/lib/ai-guard';
import { cancelPremium, startPremium } from '@/lib/asaas';
import { AsaasError, asaasConfigured } from '@/lib/asaas-client';
import { validCpf } from '@/lib/premium';
import { reportServerError } from '@/lib/server-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** { action: 'assinar', cpf } abre o pagamento do Premium; { action: 'cancelar' } encerra a assinatura. Só o próprio paciente. */
export async function POST(req: Request) {
  const account = await verifyAccount(req);
  if (!account) return json({ error: 'Entre novamente no aplicativo.' }, 401);
  if (account.profile?.role !== 'patient') return json({ error: 'O Premium é para pacientes.' }, 403);
  if (!allowRequest(`premium:${account.uid}`, 10)) return json({ error: 'Muitos pedidos em pouco tempo. Aguarde alguns minutos e tente de novo.' }, 429);
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse((await req.text()).slice(0, 2000));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ error: 'Dados inválidos.' }, 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'Dados inválidos.' }, 400);
  }
  if (!asaasConfigured()) return json({ error: 'O pagamento pelo app ainda está sendo configurado. Tente de novo mais tarde.' }, 503);

  try {
    const db = getAdminDb();
    if (body.action === 'cancelar') {
      const result = await cancelPremium(db, account.uid);
      return result.ok ? json({ ok: true }) : json({ error: result.error }, result.status);
    }
    if (body.action !== 'assinar') return json({ error: 'Dados inválidos.' }, 400);
    const result = await startPremium(db, account.uid, { email: account.email, cpf: validCpf(body.cpf) });
    return result.ok ? json({ invoiceUrl: result.invoiceUrl }) : json({ error: result.error }, result.status);
  } catch (error) {
    // Recusa do Asaas por causa dos dados (ex.: CPF que ele não aceita) volta para a pessoa corrigir.
    if (error instanceof AsaasError && error.status === 400) return json({ error: error.message }, 422);
    reportServerError('Premium: falha ao falar com o Asaas.', error);
    return json({ error: 'Não foi possível abrir o pagamento agora. Tente de novo em instantes.' }, 503);
  }
}
