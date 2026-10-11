import { json, verifyCaller } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Chamada quando o paciente escolhe uma nutricionista. O aviso por e-mail ainda não é enviado
 * de verdade: a rota só confirma o pedido de um paciente logado, sem gravar nem registrar dados pessoais.
 */
export async function POST(req: Request) {
  const caller = await verifyCaller(req);
  if (!caller || caller.role !== 'patient') return json({ error: 'Acesso permitido só para pacientes.' }, 403);
  return json({ success: true, emailSent: false });
}
