import { getAdminDb, json, verifyCaller } from '@/lib/firebase-admin';
import { allowRequest } from '@/lib/ai-guard';
import { patientOf } from '@/lib/consultation-notes';
import { localDateKey } from '@/lib/agenda';
import { loadSettings } from '@/lib/google-workspace';
import { addFollowup, completeFollowup, loadFollowups, loadPreferences, rememberPreference, removeMemoryItem } from '@/lib/ali-memory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Memória da Ali na tela Minha Ali: as preferências de trabalho que a nutricionista pediu para lembrar e as pendências.
 * É a mesma memória que a Ali usa nas conversas; aqui ela confere, acrescenta, conclui e apaga.
 */
async function nutritionist(req: Request) {
  const caller = await verifyCaller(req);
  return caller && caller.role === 'nutritionist' ? caller : null;
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await req.text();
    if (text.length > 4000) return null;
    const body = JSON.parse(text);
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

/** A Ali responde com uma frase falada; para a tela, só interessa se deu certo e o motivo quando não deu. */
const fromResult = (result: { ok: boolean; speech: string; status?: number }) =>
  (result.ok ? json({ ok: true, message: result.speech }) : json({ error: result.speech }, result.status && result.status >= 400 ? result.status : 422));

export async function GET(req: Request) {
  const caller = await nutritionist(req);
  if (!caller) return json({ error: 'Acesso permitido só para nutricionistas.' }, 403);
  try {
    const db = getAdminDb();
    const [preferences, followups] = await Promise.all([loadPreferences(db, caller.uid), loadFollowups(db, caller.uid)]);
    return json({ preferences, followups, today: localDateKey(new Date(), (await loadSettings(db, caller.uid)).timezone) });
  } catch {
    return json({ error: 'Não foi possível carregar a memória da Ali agora.' }, 503);
  }
}

/** Acrescenta: { kind: 'preference', text } ou { kind: 'followup', text, dueDate?, patientId? }. */
export async function POST(req: Request) {
  const caller = await nutritionist(req);
  if (!caller) return json({ error: 'Acesso permitido só para nutricionistas.' }, 403);
  if (!allowRequest(`memory:${caller.uid}`, 60)) return json({ error: 'Muitas alterações em pouco tempo. Aguarde um pouco e tente de novo.' }, 429);
  const body = await readBody(req);
  if (!body) return json({ error: 'Dados inválidos.' }, 400);
  try {
    const db = getAdminDb();
    if (body.kind === 'preference') return fromResult(await rememberPreference(db, caller.uid, { text: body.text }, 'app'));
    if (body.kind !== 'followup') return json({ error: 'Escolha preferência ou pendência.' }, 400);
    let patient: { uid: string; name: string } | null = null;
    if (body.patientId) {
      patient = await patientOf(db, caller.uid, body.patientId);
      if (!patient) return json({ error: 'Paciente não encontrado na sua lista.' }, 404);
    }
    const today = localDateKey(new Date(), (await loadSettings(db, caller.uid)).timezone);
    return fromResult(await addFollowup(db, caller.uid, patient, { text: body.text, dueDate: body.dueDate || undefined }, today, 'app'));
  } catch {
    return json({ error: 'Não foi possível salvar agora. Tente de novo em instantes.' }, 503);
  }
}

/** Conclui uma pendência: { id }. */
export async function PATCH(req: Request) {
  const caller = await nutritionist(req);
  if (!caller) return json({ error: 'Acesso permitido só para nutricionistas.' }, 403);
  const body = await readBody(req);
  if (!body || typeof body.id !== 'string') return json({ error: 'Dados inválidos.' }, 400);
  try {
    return fromResult(await completeFollowup(getAdminDb(), caller.uid, { id: body.id }));
  } catch {
    return json({ error: 'Não foi possível concluir a pendência agora.' }, 503);
  }
}

export async function DELETE(req: Request) {
  const caller = await nutritionist(req);
  if (!caller) return json({ error: 'Acesso permitido só para nutricionistas.' }, 403);
  const id = new URL(req.url).searchParams.get('id');
  try {
    const removed = await removeMemoryItem(getAdminDb(), caller.uid, id);
    if (!removed) return json({ error: 'Item não encontrado.' }, 404);
    return json({ ok: true });
  } catch {
    return json({ error: 'Não foi possível apagar agora.' }, 503);
  }
}
