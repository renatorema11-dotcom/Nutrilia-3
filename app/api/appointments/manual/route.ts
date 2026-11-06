import { getAdminDb, json, verifyCaller } from '@/lib/firebase-admin';
import { createManualAppointment } from '@/lib/manual-appointments';
import { reportServerError } from '@/lib/server-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Botão "Nova Consulta" do app: a consulta marcada à mão passa a aparecer para a nutricionista e para o paciente. */
export async function POST(req: Request) {
  const caller = await verifyCaller(req);
  if (!caller) return json({ error: 'Entre novamente no aplicativo.' }, 401);
  let body: unknown;
  try { body = JSON.parse((await req.text()).slice(0, 2000)); } catch { return json({ error: 'Dados inválidos.' }, 400); }
  try {
    const result = await createManualAppointment(getAdminDb(), caller, body);
    if (!result.ok) return json({ error: result.error }, result.status);
    return json({ ok: true, appointment: result.appointment, shared: result.shared });
  } catch (error) {
    reportServerError('Consulta manual: falha ao gravar.', error);
    return json({ error: 'Não foi possível marcar agora. Tente de novo em instantes.' }, 503);
  }
}
