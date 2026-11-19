import { getAdminDb, json, verifyCaller } from '@/lib/firebase-admin';
import { allowRequest } from '@/lib/ai-guard';
import { patientOf } from '@/lib/consultation-notes';
import { loadClinicalProfile, saveClinicalProfile } from '@/lib/clinical-profile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Ficha clínica de um paciente, na tela do prontuário: alergias, intolerâncias, restrições, condições, medicamentos e o
 * que mais a nutricionista anotar. Só a nutricionista responsável lê e grava (a coleção é fechada ao navegador).
 */
const PROFILE_MAX_BODY = 16_000;

async function nutritionist(req: Request) {
  const caller = await verifyCaller(req);
  return caller && caller.role === 'nutritionist' ? caller : null;
}

export async function GET(req: Request) {
  const caller = await nutritionist(req);
  if (!caller) return json({ error: 'Acesso permitido só para nutricionistas.' }, 403);
  const patientId = new URL(req.url).searchParams.get('patientId');
  try {
    const db = getAdminDb();
    const patient = await patientOf(db, caller.uid, patientId);
    if (!patient) return json({ error: 'Paciente não encontrado na sua lista.' }, 404);
    return json({ profile: await loadClinicalProfile(db, caller.uid, patient.uid) });
  } catch {
    return json({ error: 'Não foi possível carregar a ficha agora.' }, 503);
  }
}

export async function POST(req: Request) {
  const caller = await nutritionist(req);
  if (!caller) return json({ error: 'Acesso permitido só para nutricionistas.' }, 403);
  if (!allowRequest(`clinical:${caller.uid}`, 60)) return json({ error: 'Muitas alterações em pouco tempo. Aguarde um pouco e tente de novo.' }, 429);
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > PROFILE_MAX_BODY) return json({ error: 'A ficha ficou grande demais.' }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: 'Dados inválidos.' }, 400);
  }
  const data = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  try {
    const db = getAdminDb();
    const patient = await patientOf(db, caller.uid, data.patientId);
    if (!patient) return json({ error: 'Paciente não encontrado na sua lista.' }, 404);
    // A tela salva a ficha inteira. Se ela mudou depois que a tela abriu (a Ali anotou algo por voz, ou outra aba
    // salvou), salvar por cima apagaria isso: a tela recebe a ficha atual e a nutricionista confere antes.
    if (data.expectedUpdatedAt !== undefined) {
      const current = await loadClinicalProfile(db, caller.uid, patient.uid);
      if ((current.updatedAt || null) !== (typeof data.expectedUpdatedAt === 'string' ? data.expectedUpdatedAt : null)) {
        return json({ error: 'A ficha mudou enquanto você editava (a Ali pode ter anotado algo). Ela foi atualizada aqui: confira e salve de novo.', profile: current }, 409);
      }
    }
    return json({ profile: await saveClinicalProfile(db, caller.uid, patient.uid, data.profile, 'app') });
  } catch {
    return json({ error: 'Não foi possível salvar a ficha agora. Tente de novo em instantes.' }, 503);
  }
}
