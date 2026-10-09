// Firebase Admin para as rotas do servidor (mesma conta de serviço da API da Ali).
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

/** Confere o ID token enviado em "Authorization: Bearer ..." e o papel salvo no perfil. */
export async function verifyCaller(req: Request): Promise<Caller | null> {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || token.length > 8192) return null;
  try {
    const decoded = await getAuth(getAdminApp()).verifyIdToken(token, true);
    if (decoded.firebase?.sign_in_provider === 'anonymous') return null;
    const snap = await getAdminDb().collection('users').doc(decoded.uid).get();
    const role = snap.exists ? snap.data()?.role : null;
    return role === 'patient' || role === 'nutritionist' ? { uid: decoded.uid, role } : null;
  } catch {
    return null;
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}
