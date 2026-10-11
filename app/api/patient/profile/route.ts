import { getAdminDb, json, verifyCaller } from '@/lib/firebase-admin';
import { saveProfile, syncLegacyProfile } from '@/lib/patient-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Dados que o próprio paciente informa (triagem inicial e configurações). O servidor confere e grava no prontuário.
 * Com { sync: true } faz o conserto único das contas antigas, que tinham a triagem guardada fora do prontuário.
 */
export async function POST(req: Request) {
  const caller = await verifyCaller(req);
  if (!caller) return json({ error: 'Entre novamente no aplicativo.' }, 401);
  if (caller.role !== 'patient') return json({ error: 'Esta função é só para pacientes.' }, 403);
  let body: unknown;
  try { body = JSON.parse((await req.text()).slice(0, 4000)); } catch { return json({ error: 'Dados inválidos.' }, 400); }
  try {
    const db = getAdminDb();
    if (body && typeof body === 'object' && (body as Record<string, unknown>).sync === true) {
      return json({ ok: true, ...(await syncLegacyProfile(db, caller.uid)) });
    }
    const result = await saveProfile(db, caller.uid, body);
    if (!result.ok) return json({ error: result.error }, 422);
    return json({ ok: true, profile: result.profile });
  } catch {
    console.error('Perfil do paciente: falha ao gravar.');
    return json({ error: 'Não foi possível salvar agora. Tente de novo em instantes.' }, 503);
  }
}
