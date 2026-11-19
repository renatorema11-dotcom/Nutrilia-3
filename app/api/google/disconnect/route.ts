import { getAdminDb, json, verifyCaller } from '@/lib/firebase-admin';
import { disconnect, getGoogleConfig } from '@/lib/google-workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Remove a conexão do Google da nutricionista logada e revoga a autorização no Google. */
export async function POST(req: Request) {
  const caller = await verifyCaller(req);
  if (!caller || caller.role !== 'nutritionist') return json({ error: 'Acesso permitido só para nutricionistas.' }, 403);
  try {
    await disconnect(getAdminDb(), getGoogleConfig(), caller.uid);
    return json({ ok: true });
  } catch {
    return json({ error: 'Não foi possível desconectar agora.' }, 503);
  }
}
