import { getAdminDb, json, verifyAccount } from '@/lib/firebase-admin';
import { allowRequest } from '@/lib/ai-guard';
import { AsaasError, asaasConfigured } from '@/lib/asaas-client';
import { patientPaymentInfo, startConsultationPayment } from '@/lib/consultation-payments';
import { reportServerError } from '@/lib/server-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Se a nutricionista do paciente recebe pelo app, e o preço da consulta. */
export async function GET(req: Request) {
  const account = await verifyAccount(req);
  if (!account) return json({ error: 'Entre novamente no aplicativo.' }, 401);
  if (account.profile?.role !== 'patient') return json({ enabled: false, price: null });
  try {
    const info = await patientPaymentInfo(getAdminDb(), account.uid);
    return json({ ...info, enabled: info.enabled && asaasConfigured() });
  } catch {
    return json({ enabled: false, price: null });
  }
}

/** { appointmentId, cpf? } abre o pagamento da consulta. Sem CPF na primeira vez, responde needCpf. */
export async function POST(req: Request) {
  const account = await verifyAccount(req);
  if (!account) return json({ error: 'Entre novamente no aplicativo.' }, 401);
  if (account.profile?.role !== 'patient') return json({ error: 'O pagamento da consulta é feito pelo paciente.' }, 403);
  if (!allowRequest(`consultation-pay:${account.uid}`, 15)) return json({ error: 'Muitos pedidos em pouco tempo. Aguarde alguns minutos.' }, 429);
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
    const result = await startConsultationPayment(getAdminDb(), account.uid, account.email, body);
    if (result.ok) return json({ invoiceUrl: result.invoiceUrl });
    return json({ error: result.error, ...(result.needCpf ? { needCpf: true } : {}) }, result.status);
  } catch (error) {
    if (error instanceof AsaasError && error.status === 400) return json({ error: error.message }, 422);
    reportServerError('Consulta paga: falha ao falar com o Asaas.', error);
    return json({ error: 'Não foi possível abrir o pagamento agora. Tente de novo em instantes.' }, 503);
  }
}
