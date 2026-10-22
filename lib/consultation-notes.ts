// Anotações das consultas: o que a nutricionista registra sobre cada paciente. Somente no servidor.
// Ficam na coleção consultationNotes, fechada ao navegador pelas regras (tudo o que não está liberado é negado):
// o paciente não vê. A tela da nutricionista lê e grava pela rota /api/nutritionist/consultation-notes,
// e a Ali da nutricionista pela rota dela; as duas conferem antes que o paciente é dessa nutricionista.
import type { Firestore } from 'firebase-admin/firestore';

export const NOTES_COLLECTION = 'consultationNotes';
export const NOTE_MAX_LENGTH = 4000;

export interface ConsultationNote { id: string; text: string; createdAt: string; source: 'app' | 'ali' }

/** Texto da anotação sem caracteres de controle, sem espaços sobrando e sem linhas em branco demais. */
export function cleanNote(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('/');

/** O paciente, se ele for dessa nutricionista; senão null (vale também para paciente que não existe). */
export async function patientOf(db: Firestore, nutritionistId: string, patientUid: unknown): Promise<{ uid: string; name: string } | null> {
  if (!validId(patientUid)) return null;
  const snap = await db.collection('patients').doc(patientUid).get();
  const data = snap.exists ? snap.data() || {} : null;
  if (!data || data.nutritionistId !== nutritionistId) return null;
  return { uid: patientUid, name: typeof data.name === 'string' ? data.name.trim() : '' };
}

export async function saveNote(db: Firestore, nutritionistId: string, patientUid: string, text: string, source: 'app' | 'ali', now = new Date()): Promise<ConsultationNote> {
  const createdAt = now.toISOString();
  const ref = await db.collection(NOTES_COLLECTION).add({ nutritionistId, patientUid, text, source, createdAt });
  return { id: ref.id, text, createdAt, source };
}

/** Anotações de um paciente, da mais nova para a mais antiga. */
export async function listNotesFor(db: Firestore, nutritionistId: string, patientUid: string, max = 50): Promise<ConsultationNote[]> {
  // Só filtros de igualdade: não precisa de índice composto no Firestore. A ordem é feita aqui.
  const snap = await db.collection(NOTES_COLLECTION).where('nutritionistId', '==', nutritionistId).where('patientUid', '==', patientUid).get();
  return snap.docs
    .map((doc): ConsultationNote => {
      const d = doc.data() || {};
      return { id: doc.id, text: typeof d.text === 'string' ? d.text : '', createdAt: typeof d.createdAt === 'string' ? d.createdAt : '', source: d.source === 'ali' ? 'ali' : 'app' };
    })
    .filter((note) => note.text)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, max);
}

/** Apaga uma anotação da própria nutricionista. Devolve false quando ela não existe ou é de outra pessoa. */
export async function removeNote(db: Firestore, nutritionistId: string, noteId: unknown): Promise<boolean> {
  if (!validId(noteId)) return false;
  const ref = db.collection(NOTES_COLLECTION).doc(noteId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.nutritionistId !== nutritionistId) return false;
  await ref.delete();
  return true;
}
