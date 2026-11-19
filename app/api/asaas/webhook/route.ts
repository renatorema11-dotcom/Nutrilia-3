import { getAdminDb, json } from '@/lib/firebase-admin';
import { handleAsaasEvent, webhookAuthorized } from '@/lib/asaas';
import { reportServerError } from '@/lib/server-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Avisos de pagamento do Asaas (webhook). Só passa com o token combinado. Responde 200 a tudo o que foi tratado
 * ou ignorado; erro temporário responde 500 para o Asaas tentar de novo.
 */
export async function POST(req: Request) {
  if (!webhookAuthorized(req.headers.get('asaas-access-token'))) return json({ error: 'Não autorizado.' }, 401);
  let event: unknown;
  try {
    event = JSON.parse((await req.text()).slice(0, 200_000));
  } catch {
    return json({ ok: true, result: 'ignorado' });
  }
  try {
    return json({ ok: true, result: await handleAsaasEvent(getAdminDb(), event) });
  } catch (error) {
    reportServerError('Asaas: falha ao tratar um aviso de pagamento.', error);
    return json({ error: 'Falha temporária.' }, 500);
  }
}
