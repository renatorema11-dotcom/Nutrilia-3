import { getAdminDb, json, verifyCaller } from '@/lib/firebase-admin';
import { cancelAppointmentById } from '@/lib/appointments';
import { MANUAL_PREFIX, cancelManualAppointment } from '@/lib/manual-appointments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Botão de cancelar do app. Consulta marcada pela Ali: sai da agenda do Google e a outra parte é avisada.
 * Consulta marcada à mão: fica cancelada na lista da nutricionista e na do paciente.
 */
export async function POST(req: Request) {
  const caller = await verifyCaller(req);
  if (!caller) return json({ error: 'Entre novamente no aplicativo.' }, 401);
  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: 'Dados inválidos.' }, 400); }
  const id = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).id : undefined;
  if (typeof id !== 'string' || !id || id.length > 200) return json({ error: 'Dados inválidos.' }, 400);
  try {
    if (id.startsWith(MANUAL_PREFIX)) {
      const manual = await cancelManualAppointment(getAdminDb(), caller, id);
      if (!manual.ok) return json({ error: manual.error }, manual.status);
      return json({ ok: true, message: 'Consulta cancelada.' });
    }
    const result = await cancelAppointmentById(getAdminDb(), caller, id);
    if (!result.ok) return json({ error: result.speech }, result.status);
    return json({ ok: true, message: result.speech });
  } catch {
    return json({ error: 'Não foi possível cancelar agora.' }, 503);
  }
}
