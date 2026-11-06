import { json, verifyCaller } from '@/lib/firebase-admin';
import { allowRequest } from '@/lib/ai-guard';
import { createAliSession } from '@/lib/ali-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Entrega a credencial de uma conversa com a Ali a quem está logado: paciente fala com a Ali dos pacientes,
 * nutricionista com a Ali dela. Sem a chave da ElevenLabs no servidor responde 503, e a tela segue pelo caminho antigo.
 */
export async function POST(req: Request) {
  const caller = await verifyCaller(req);
  if (!caller) return json({ error: 'Entre novamente no aplicativo.' }, 401);
  if (!allowRequest(`ali-session:${caller.uid}`, 30)) {
    return json({ error: 'Muitas conversas iniciadas em pouco tempo. Aguarde alguns minutos e tente de novo.' }, 429);
  }
  let mode: 'voice' | 'text' = 'voice';
  try {
    const body: unknown = JSON.parse((await req.text()).slice(0, 200) || '{}');
    if (body && typeof body === 'object' && (body as Record<string, unknown>).mode === 'text') mode = 'text';
  } catch {
    return json({ error: 'Dados inválidos.' }, 400);
  }
  const session = await createAliSession(caller.role, mode);
  if (!session.ok) return json({ error: 'A Ali está indisponível no momento.', reason: session.reason }, session.status);
  return json(session.signedUrl ? { signedUrl: session.signedUrl } : { conversationToken: session.conversationToken });
}
