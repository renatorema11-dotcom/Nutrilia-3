import { getAdminDb } from '@/lib/firebase-admin';
import { completeConnection, getGoogleConfig, verifyState } from '@/lib/google-workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NONCE_COOKIE = 'nutriali_google_nonce';

function readCookie(req: Request, name: string): string {
  const match = (req.headers.get('cookie') || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : '';
}

/** Volta do Google: confere quem iniciou, guarda a autorização e retorna para a página Minha Ali. */
export async function GET(req: Request) {
  const cfg = getGoogleConfig();
  const back = (result: string) => new Response(null, {
    status: 302,
    headers: {
      location: new URL(`/nutritionist/ali?google=${result}`, cfg?.redirectUri || req.url).toString(),
      'set-cookie': `${NONCE_COOKIE}=; Path=/api/google; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
      'cache-control': 'no-store',
    },
  });
  if (!cfg) return back('nao-configurado');

  const params = new URL(req.url).searchParams;
  if (params.get('error')) return back('cancelado');
  const code = params.get('code') || '';
  const state = verifyState(cfg, params.get('state') || '');
  if (!code || !state || readCookie(req, NONCE_COOKIE) !== state.nonce) return back('expirado');

  try {
    const db = getAdminDb();
    const user = await db.collection('users').doc(state.uid).get();
    if (!user.exists || user.data()?.role !== 'nutritionist') return back('erro');
    const result = await completeConnection(db, cfg, state.uid, code);
    if (!result.ok) return back(result.reason === 'scopes' ? 'permissoes' : 'erro');
    return back('conectado');
  } catch {
    return back('erro');
  }
}
