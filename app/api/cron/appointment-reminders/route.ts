import { getAdminDb, hasGatewaySecret, json } from '@/lib/firebase-admin';
import { runAppointmentReminders } from '@/lib/appointments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Chamado pelo n8n a cada poucos minutos: envia os lembretes de consulta que estão na hora. */
export async function POST(req: Request) {
  if (!hasGatewaySecret(req)) return json({ ok: false, error: 'Não autorizado.' }, 401);
  try {
    // A resposta só tem contagens: nenhum dado de paciente sai do app.
    return json({ ok: true, ...(await runAppointmentReminders(getAdminDb())) });
  } catch {
    console.error('Lembretes: falha ao processar.');
    return json({ ok: false, error: 'Não foi possível processar os lembretes agora.' }, 500);
  }
}
