import { getAdminDb, json } from '@/lib/firebase-admin';
import { allowRequest } from '@/lib/ai-guard';
import { approvalByLink, decideByLink, readApprovalLink } from '@/lib/nutritionist-approval';
import { reportServerError } from '@/lib/server-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Aprovação pelo link do e-mail de aviso, sem login: o código assinado do link é a autorização, vale para um
 * cadastro só e por 30 dias. Sem "decision", devolve os dados do cadastro para a tela mostrar; com
 * "decision" ('approve' ou 'reject'), registra a decisão. Tudo por POST: abrir o link não decide nada sozinho.
 */
export async function POST(req: Request) {
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

  const link = readApprovalLink(body.token);
  // O limite vale por cadastro: um link válido não vira porta para pedidos sem fim.
  if (link.ok && !allowRequest(`approval-link:${link.uid}`, 40)) {
    return json({ error: 'Muitos pedidos em pouco tempo. Aguarde alguns minutos e tente de novo.' }, 429);
  }
  try {
    if (body.decision === undefined) {
      const view = await approvalByLink(getAdminDb(), body.token);
      return view.ok ? json({ record: view.record }) : json({ error: view.error }, view.status);
    }
    const result = await decideByLink(getAdminDb(), body.token, body.decision);
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ approval: result.approval, emailed: result.emailed });
  } catch (error) {
    reportServerError('Aprovação pelo link: falha ao processar.', error);
    return json({ error: 'Não foi possível concluir agora. Tente de novo em instantes.' }, 503);
  }
}
