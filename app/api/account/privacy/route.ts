import { getAdminDb, json, verifyAccount } from '@/lib/firebase-admin';
import { allowRequest } from '@/lib/ai-guard';
import { deletionStatusOf, requestDeletion } from '@/lib/account-privacy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Situação do pedido de exclusão da própria conta (null quando não há pedido). */
export async function GET(req: Request) {
  const account = await verifyAccount(req);
  if (!account || !account.profile) return json({ error: 'Entre novamente no aplicativo.' }, 401);
  try {
    return json({ deletion: await deletionStatusOf(getAdminDb(), account.uid) });
  } catch {
    return json({ error: 'Não foi possível consultar agora.' }, 503);
  }
}

/** Pede a exclusão da própria conta: { action: 'request_deletion', reason? }. O responsável analisa e responde. */
export async function POST(req: Request) {
  const account = await verifyAccount(req);
  if (!account || !account.profile) return json({ error: 'Entre novamente no aplicativo.' }, 401);
  if (!allowRequest(`deletion:${account.uid}`, 5)) return json({ error: 'Muitos pedidos em pouco tempo. Aguarde alguns minutos e tente de novo.' }, 429);
  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    if (text.length > 2000) return json({ error: 'Dados inválidos.' }, 413);
    const parsed: unknown = text ? JSON.parse(text) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({ error: 'Dados inválidos.' }, 400);
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'Dados inválidos.' }, 400);
  }
  if (body.action !== 'request_deletion') return json({ error: 'Pedido não reconhecido.' }, 400);
  try {
    const result = await requestDeletion(getAdminDb(), account.uid, account.profile, body.reason);
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ deletion: result.deletion });
  } catch {
    console.error('Exclusão: falha ao registrar o pedido.');
    return json({ error: 'Não foi possível registrar o pedido agora. Tente de novo em instantes.' }, 503);
  }
}
