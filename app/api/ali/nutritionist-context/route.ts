import { getAdminDb, json, verifyCaller } from '@/lib/firebase-admin';
import { assistantContext } from '@/lib/nutritionist-assistant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Informações que a Ali da nutricionista recebe ao começar a conversa (nome, atendimento, quantos pacientes). */
export async function GET(req: Request) {
  const caller = await verifyCaller(req);
  if (!caller || caller.role !== 'nutritionist') return json({ error: 'Acesso permitido só para nutricionistas.' }, 403);
  try {
    return json({ dynamicVariables: await assistantContext(getAdminDb(), caller.uid) });
  } catch {
    return json({ error: 'Não foi possível carregar a assistente agora.' }, 503);
  }
}
