import { getAdminDb, hasGatewaySecret, json } from '@/lib/firebase-admin';
import { runAppointmentReminders } from '@/lib/appointments';
import { runPatientNotices } from '@/lib/patient-notices';
import { notifyServerError, reportServerError } from '@/lib/server-alerts';

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
  } catch (error) {
    reportServerError('Lembretes: falha ao processar.', error);
    return json({ ok: false, error: 'Não foi possível processar os lembretes agora.' }, 500);
  }
  // Uma falha nos avisos não atrapalha os lembretes: fica só registrada na resposta e no servidor.
  let notices;
  try {
    notices = await runPatientNotices(getAdminDb());
  } catch (error) {
    reportServerError('Avisos ao paciente: falha ao processar.', error);
    notices = { error: true };
  }
  // E-mails que não saíram tentam de novo na rodada seguinte; o responsável fica sabendo se continuar.
  if ('failed' in notices && notices.failed > 0) notifyServerError('Avisos ao paciente: há e-mails de aviso que não saíram.');
  // A resposta só tem contagens: nenhum dado de paciente sai do app.
  return json({ ok: true, ...reminders, notices });
}
