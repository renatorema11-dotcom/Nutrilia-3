import { getAdminDb, json, verifyCaller } from '@/lib/firebase-admin';
import { notifyNewPatient } from '@/lib/google-workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Chamada quando o paciente escolhe uma nutricionista. Quem é a nutricionista vem do prontuário, não do navegador.
 * Ela é avisada por e-mail (pelo próprio Gmail) se tiver o Google conectado na Minha Ali; sem isso, emailSent volta false.
 */
export async function POST(req: Request) {
  const caller = await verifyCaller(req);
  if (!caller || caller.role !== 'patient') return json({ error: 'Acesso permitido só para pacientes.' }, 403);
  try {
    return json({ success: true, emailSent: await notifyNewPatient(getAdminDb(), caller.uid) });
  } catch {
    return json({ success: true, emailSent: false });
  }
}
