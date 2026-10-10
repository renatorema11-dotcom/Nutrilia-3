import { getAdminDb, json, verifyCaller } from '@/lib/firebase-admin';
import { cancelAppointmentById } from '@/lib/appointments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Botão de cancelar do app para consultas marcadas pela Ali: tira da agenda do Google e avisa a outra parte. */
export async function POST(req: Request) {
  const caller = await verifyCaller(req);
  if (!caller) return json({ error: 'Entre novamente no aplicativo.' }, 401);
  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: 'Dados inválidos.' }, 400); }
  const id = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).id : undefined;
  if (typeof id !== 'string' || !id || id.length > 200) return json({ error: 'Dados inválidos.' }, 400);
  try {
    const result = await cancelAppointmentById(getAdminDb(), caller, id);
    if (!result.ok) return json({ error: result.speech }, result.status);
    return json({ ok: true, message: result.speech });
  } catch {
    return json({ error: 'Não foi possível cancelar agora.' }, 503);
  }
}
