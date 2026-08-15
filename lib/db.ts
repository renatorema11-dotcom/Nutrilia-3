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

function removeUndefined<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(removeUndefined) as unknown as T;
  }
  const cleaned: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      cleaned[key] = removeUndefined(value);
    }
  }
  return cleaned as T;
}

export async function updateUserData(uid: string, data: any) {
  if (!uid) return;
  const cleanedData = removeUndefined(data);
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, cleanedData).catch(async (e) => {
    if (e.code === 'not-found') {
      await setDoc(userRef, cleanedData, { merge: true });
    } else {
      throw e;
    }
  });
}
