import { getAuth } from 'firebase-admin/auth';
import { getAdminApp, getAdminDb, hasGatewaySecret, json } from '@/lib/firebase-admin';
import { runWeeklySummaries } from '@/lib/weekly-report';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Último acesso de cada paciente ao app, pelo login. Quem nunca entrou volta como null. */
async function lastSeen(uids: string[]): Promise<Map<string, Date | null>> {
  const auth = getAuth(getAdminApp());
  const seen = new Map<string, Date | null>();
  for (let i = 0; i < uids.length; i += 100) {
    const result = await auth.getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
    for (const user of result.users) {
      const at = user.metadata.lastRefreshTime || user.metadata.lastSignInTime;
      seen.set(user.uid, at ? new Date(at) : null);
    }
  }
  return seen;
}

/** Chamado pelo n8n toda segunda de manhã: envia o resumo da semana para cada nutricionista. */
export async function POST(req: Request) {
  if (!hasGatewaySecret(req)) return json({ ok: false, error: 'Não autorizado.' }, 401);
  try {
    // A resposta só tem contagens: nenhum dado de paciente sai do app.
    return json({ ok: true, ...(await runWeeklySummaries(getAdminDb(), lastSeen)) });
  } catch {
    console.error('Resumo semanal: falha ao processar.');
    return json({ ok: false, error: 'Não foi possível enviar os resumos agora.' }, 500);
  }
}
