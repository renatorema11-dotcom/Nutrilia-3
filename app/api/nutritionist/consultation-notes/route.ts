import { getAdminDb, json, verifyCaller } from '@/lib/firebase-admin';
import { allowRequest } from '@/lib/ai-guard';
import { NOTE_MAX_LENGTH, cleanNote, listNotesFor, patientOf, removeNote, saveNote } from '@/lib/consultation-notes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Anotações das consultas de um paciente, na tela do prontuário. Só a nutricionista responsável lê, grava e apaga;
 * o paciente não tem acesso (a coleção é fechada ao navegador e só o servidor mexe nela).
 */
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
    return json({ notes: await listNotesFor(db, caller.uid, patient.uid) });
  } catch {
    return json({ error: 'Não foi possível carregar as anotações agora.' }, 503);
  }
}

export async function POST(req: Request) {
  const caller = await nutritionist(req);
  if (!caller) return json({ error: 'Acesso permitido só para nutricionistas.' }, 403);
  if (!allowRequest(`notes:${caller.uid}`, 30)) return json({ error: 'Muitas anotações em pouco tempo. Aguarde um pouco e tente de novo.' }, 429);
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > NOTE_MAX_LENGTH * 2 + 500) return json({ error: 'A anotação ficou longa demais.' }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: 'Dados inválidos.' }, 400);
  }
  const data = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
  const text = cleanNote(data.text);
  if (text.length < 3) return json({ error: 'Escreva a anotação antes de salvar.' }, 422);
  if (text.length > NOTE_MAX_LENGTH) return json({ error: `A anotação pode ter até ${NOTE_MAX_LENGTH} caracteres.` }, 422);
  try {
    const db = getAdminDb();
    const patient = await patientOf(db, caller.uid, data.patientId);
    if (!patient) return json({ error: 'Paciente não encontrado na sua lista.' }, 404);
    return json({ note: await saveNote(db, caller.uid, patient.uid, text, 'app') });
  } catch {
    return json({ error: 'Não foi possível salvar a anotação agora. Tente de novo em instantes.' }, 503);
  }
}

export async function DELETE(req: Request) {
  const caller = await nutritionist(req);
  if (!caller) return json({ error: 'Acesso permitido só para nutricionistas.' }, 403);
  const noteId = new URL(req.url).searchParams.get('id');
  try {
    const removed = await removeNote(getAdminDb(), caller.uid, noteId);
    if (!removed) return json({ error: 'Anotação não encontrada.' }, 404);
    return json({ ok: true });
  } catch {
    return json({ error: 'Não foi possível apagar a anotação agora.' }, 503);
  }
}
