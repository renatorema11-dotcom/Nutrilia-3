import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';

export async function getUserData(uid: string) {
  if (!uid) return null;
  const userRef = doc(db, 'users', uid);
  const snap = await getDoc(userRef);
  if (snap.exists()) {
    return snap.data();
  }
  return null;
}

export async function updateUserData(uid: string, data: any) {
  if (!uid) return;
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, data).catch(async (e) => {
    if (e.code === 'not-found') {
      await setDoc(userRef, data, { merge: true });
    } else {
      throw e;
    }
  });
}
