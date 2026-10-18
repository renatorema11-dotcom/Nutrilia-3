import { getAdminDb, hasGatewaySecret, json, lastSeenLookup } from '@/lib/firebase-admin';
import { runWeeklySummaries } from '@/lib/weekly-report';
import { reportServerError } from '@/lib/server-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Chamado pelo n8n toda segunda de manhã: envia o resumo da semana para cada nutricionista. */
export async function POST(req: Request) {
  if (!hasGatewaySecret(req)) return json({ ok: false, error: 'Não autorizado.' }, 401);
  try {
    // A resposta só tem contagens: nenhum dado de paciente sai do app.
    return json({ ok: true, ...(await runWeeklySummaries(getAdminDb(), lastSeenLookup)) });
  } catch (error) {
    reportServerError('Resumo semanal: falha ao processar.', error);
    return json({ ok: false, error: 'Não foi possível enviar os resumos agora.' }, 500);
  }
}
