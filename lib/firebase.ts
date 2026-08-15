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

// Helper to create Firebase Auth user account for a patient without logging out current active user
export async function createPatientAuthUser(email: string, name: string, password = 'Mudar@123'): Promise<string | null> {
  try {
    const secondaryApp = getApps().find((a) => a.name === 'SecondaryAuthApp') || initializeApp(firebaseConfig, 'SecondaryAuthApp');
    const secondaryAuth = getAuth(secondaryApp);
    const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    if (userCredential.user) {
      await updateProfile(userCredential.user, { displayName: name });
      await signOut(secondaryAuth);
      return userCredential.user.uid;
    }
    return null;
  } catch (error: any) {
    console.warn('Patient auth registration note:', error?.message || error);
    return null;
  }
}

export { signInWithPopup, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile };
export type { User };
