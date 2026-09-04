import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Custom database ID support if configured
export const db = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

// Gerador de senha temporária segura (sem caracteres ambíguos: 0/O, 1/I/l)
const TEMP_PASSWORD_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function generateTempPassword(length = 12): string {
  const random = new Uint32Array(length);
  crypto.getRandomValues(random);
  let pw = '';
  for (let i = 0; i < length; i++) {
    pw += TEMP_PASSWORD_CHARSET[random[i] % TEMP_PASSWORD_CHARSET.length];
  }
  return pw;
}

// Helper to create Firebase Auth user account for a patient without logging out current active user.
// Retorna { uid, tempPassword } para o nutricionista compartilhar a senha apenas uma vez.
export async function createPatientAuthUser(email: string, name: string): Promise<{ uid: string | null; tempPassword: string }> {
  const tempPassword = generateTempPassword();
  try {
    const secondaryApp = getApps().find((a) => a.name === 'SecondaryAuthApp') || initializeApp(firebaseConfig, 'SecondaryAuthApp');
    const secondaryAuth = getAuth(secondaryApp);
    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, tempPassword);
    if (userCredential.user) {
      await updateProfile(userCredential.user, { displayName: name });
      await signOut(secondaryAuth);
      return { uid: userCredential.user.uid, tempPassword };
    }
    return { uid: null, tempPassword };
  } catch (error: any) {
    console.warn('Patient auth registration note:', error?.message || error);
    return { uid: null, tempPassword };
  }
}

export { signInWithPopup, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile };
export type { User };
