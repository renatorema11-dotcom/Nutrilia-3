// Firebase Admin para as rotas do servidor (mesma conta de serviço da API da Ali).
import { timingSafeEqual } from 'node:crypto';
import { initializeApp, getApps, cert, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import firebaseConfig from '../firebase-applet-config.json';

export function getAdminApp(): App {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('Admin não configurado');
  const account = JSON.parse(raw);
  if (account.project_id !== firebaseConfig.projectId) throw new Error('Projeto Admin incorreto');
  return getApps().find((a) => a.name === 'NutriAliAuthenticated')
    || initializeApp({ credential: cert(account), projectId: firebaseConfig.projectId }, 'NutriAliAuthenticated');
}

export function getAdminDb(): Firestore {
  const app = getAdminApp();
  return firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
    ? getFirestore(app, firebaseConfig.firestoreDatabaseId) : getFirestore(app);
}

export interface Caller { uid: string; role: 'patient' | 'nutritionist' }

/** Quem está logado, com o perfil como está no banco (inclusive nutricionista com cadastro em análise). */
export interface Account { uid: string; email: string; emailVerified: boolean; profile: Record<string, unknown> | null }

/** Confere o ID token enviado em "Authorization: Bearer ..." e lê o perfil. Não decide o que a pessoa pode fazer. */
export async function verifyAccount(req: Request): Promise<Account | null> {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || token.length > 8192) return null;
  try {
    const decoded = await getAuth(getAdminApp()).verifyIdToken(token, true);
    if (decoded.firebase?.sign_in_provider === 'anonymous') return null;
    const snap = await getAdminDb().collection('users').doc(decoded.uid).get();
    return {
      uid: decoded.uid,
      email: typeof decoded.email === 'string' ? decoded.email : '',
      emailVerified: decoded.email_verified === true,
      profile: snap.exists ? snap.data() || {} : null,
    };
  } catch {
    return null;
  }
}

/**
 * Confere o login e o papel salvo no perfil. Nutricionista com cadastro em análise ou recusado ainda não conta
 * como nutricionista: nenhuma função do servidor abre para ela antes da aprovação.
 */
export async function verifyCaller(req: Request): Promise<Caller | null> {
  const account = await verifyAccount(req);
  const role = account?.profile?.role;
  if (!account || (role !== 'patient' && role !== 'nutritionist')) return null;
  const approval = account.profile?.approval;
  if (role === 'nutritionist' && (approval === 'pending' || approval === 'rejected')) return null;
  return { uid: account.uid, role };
}

/** Confere o segredo do n8n (cabeçalho x-webhook-secret) nas rotas chamadas de servidor para servidor. */
export function hasGatewaySecret(req: Request): boolean {
  const expected = process.env.AGENT_API_SECRET;
  const provided = req.headers.get('x-webhook-secret');
  if (!expected || expected.length < 32 || !provided || provided.length > 4096) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}
