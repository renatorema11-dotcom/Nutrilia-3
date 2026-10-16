import { getAdminDb, hasGatewaySecret, json } from '@/lib/firebase-admin';
import { runAppointmentReminders } from '@/lib/appointments';
import { runPatientNotices } from '@/lib/patient-notices';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Chamado pelo n8n a cada poucos minutos: envia os lembretes de consulta que estão na hora e, na mesma chamada,
 * os avisos ao paciente (recado novo no chat, plano novo e resposta a pedido de consulta).
 */
export async function POST(req: Request) {
  if (!hasGatewaySecret(req)) return json({ ok: false, error: 'Não autorizado.' }, 401);
  let reminders;
  try {
    reminders = await runAppointmentReminders(getAdminDb());
  } catch {
    console.error('Lembretes: falha ao processar.');
    return json({ ok: false, error: 'Não foi possível processar os lembretes agora.' }, 500);
  }
  // Uma falha nos avisos não atrapalha os lembretes: fica só registrada na resposta e no servidor.
  let notices;
  try {
    notices = await runPatientNotices(getAdminDb());
  } catch {
    console.error('Avisos ao paciente: falha ao processar.');
    notices = { error: true };
  }
  // A resposta só tem contagens: nenhum dado de paciente sai do app.
  return json({ ok: true, ...reminders, notices });
}
