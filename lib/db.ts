import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';

export async function getUserData(uid: string) {
  if (!uid) return null;
  const userRef = doc(db, 'users', uid);
  const snap = await getDoc(userRef);
  if (snap.exists()) {
    const profile = snap.data();
    if (profile.role !== 'patient') return profile;
    // O prontuário é a fonte comum das telas e das ações autenticadas da Ali.
    const patientSnap = await getDoc(doc(db, 'patients', uid));
    if (!patientSnap.exists()) return profile;
    const patient = patientSnap.data();
    const approvedPlan = patient.currentPlan?.status === 'approved' ? patient.currentPlan : null;
    return { ...profile, patientData: { ...patient, currentPlan: approvedPlan }, currentPlan: approvedPlan };
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
