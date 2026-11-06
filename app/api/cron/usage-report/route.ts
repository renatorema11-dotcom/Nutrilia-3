import { getAdminDb, hasGatewaySecret, json } from '@/lib/firebase-admin';
import { usageReport } from '@/lib/weekly-report';
import { reportServerError } from '@/lib/server-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Chamado pelo n8n: números de uso da Ali nos últimos 7 dias, sem nomes, e-mails ou dados de saúde. */
export async function POST(req: Request) {
  if (!hasGatewaySecret(req)) return json({ ok: false, error: 'Não autorizado.' }, 401);
  try {
    return json({ ok: true, ...(await usageReport(getAdminDb())) });
  } catch (error) {
    reportServerError('Relatório de uso: falha ao processar.', error);
    return json({ ok: false, error: 'Não foi possível montar o relatório agora.' }, 500);
  }
}
