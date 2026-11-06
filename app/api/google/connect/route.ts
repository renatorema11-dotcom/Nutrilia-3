import { json, verifyCaller } from '@/lib/firebase-admin';
import { buildAuthUrl, getGoogleConfig, newNonce, signState } from '@/lib/google-workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NONCE_COOKIE = 'nutriali_google_nonce';

/** Inicia a conexão do Google da nutricionista logada e devolve o endereço de autorização. */
export async function POST(req: Request) {
  const caller = await verifyCaller(req);
  if (!caller || caller.role !== 'nutritionist') return json({ error: 'Acesso permitido só para nutricionistas.' }, 403);
  const cfg = getGoogleConfig();
  if (!cfg) return json({ error: 'A conexão com o Google ainda não foi configurada no servidor.' }, 503);
  const nonce = newNonce();
  // O nonce também vai num cookie: o retorno do Google só é aceito no mesmo navegador que pediu.
  return json({ url: buildAuthUrl(cfg, signState(cfg, caller.uid, nonce)) }, 200, {
    'set-cookie': `${NONCE_COOKIE}=${nonce}; Path=/api/google; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
  });
}
