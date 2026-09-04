import { collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, createPatientAuthUser } from './firebase';

export interface Measurement {
  date: string;
  weight: number;
  bodyFat?: number;
  height?: number;
}

export interface Meal {
  time: string;
  name: string;
  items: string[];
}

export interface PlanDay {
  name: string;
  meals: Meal[];
}

export interface Plan {
  id: string;
  status: 'draft' | 'approved';
  createdDate: string;
  days?: PlanDay[];
}

export interface Patient {
  id: string;
  name: string;
  email: string;
  age: number;
  weight: number;
  height: number;
  targetWeight?: number;
  initialWeight?: number;
  bodyFat?: number;
  objective: string;
  createdAt: string;
  nextAppointment?: string;
  measurements: Measurement[];
  currentPlan?: Plan | null;
  pastPlans?: Plan[];
  /** Senha temporária gerada no cadastro — NÃO é persistida no Firestore. Exibida uma única vez ao nutricionista. */
  tempPassword?: string;
}

const LOCAL_STORAGE_KEY = 'nutri_real_patients';

export function getLocalPatients(): Patient[] {
  if (typeof window === 'undefined') return [];
  try {
    const data = localStorage.getItem(LOCAL_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function setLocalPatients(patients: Patient[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(patients));
  } catch (err) {
    console.error('Error writing to local storage', err);
  }
}

export async function getPatients(): Promise<Patient[]> {
  try {
    const querySnapshot = await getDocs(collection(db, 'patients'));
    const firestorePatients: Patient[] = [];
    querySnapshot.forEach((docSnap) => {
      firestorePatients.push({ id: docSnap.id, ...docSnap.data() } as Patient);
    });

    if (firestorePatients.length > 0) {
      setLocalPatients(firestorePatients);
      return firestorePatients;
    }
  } catch (error) {
    console.warn('Firestore offline or failed, falling back to local storage:', error);
  }

  return getLocalPatients();
}

export async function getPatientById(id: string): Promise<Patient | null> {
  try {
    const docRef = doc(db, 'patients', id);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      return { id: docSnap.id, ...docSnap.data() } as Patient;
    }
  } catch (error) {
    console.warn('Error fetching patient from Firestore:', error);
  }

  const local = getLocalPatients();
  return local.find((p) => p.id === id) || null;
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

export async function createPatient(data: {
  name: string;
  email: string;
  age: number;
  weight: number;
  height: number;
  targetWeight?: number;
  bodyFat?: number;
  objective: string;
}): Promise<Patient> {
  let newId = 'pat_' + Date.now();
  const now = new Date().toISOString();
  let tempPassword: string | undefined;

  if (data.email) {
    const { uid, tempPassword: generatedPassword } = await createPatientAuthUser(data.email, data.name);
    if (uid) {
      newId = uid;
      tempPassword = generatedPassword;
    }
  }

  const initialMeasurement: Measurement = {
    date: now.split('T')[0],
    weight: Number(data.weight),
    height: Number(data.height),
    bodyFat: data.bodyFat ? Number(data.bodyFat) : undefined,
  };

  const newPatient: Patient = {
    id: newId,
    name: data.name,
    email: data.email,
    age: Number(data.age),
    weight: Number(data.weight),
    height: Number(data.height),
    targetWeight: data.targetWeight ? Number(data.targetWeight) : undefined,
    initialWeight: Number(data.weight),
    bodyFat: data.bodyFat ? Number(data.bodyFat) : undefined,
    objective: data.objective || 'Saúde Geral',
    createdAt: now,
    measurements: [initialMeasurement],
    currentPlan: null,
    pastPlans: [],
  };

  try {
    const sanitizedPatient = removeUndefined(newPatient);
    await setDoc(doc(db, 'patients', newId), sanitizedPatient);

    if (data.email) {
      await setDoc(doc(db, 'users', newId), removeUndefined({
        id: newId,
        email: data.email,
        displayName: data.name,
        role: 'patient',
        createdAt: now,
        mustChangePassword: true,
        patientData: sanitizedPatient
      }), { merge: true });
    }
  } catch (error) {
    console.error('Failed to save patient to Firestore, saving locally:', error);
  }

  const currentLocal = getLocalPatients();
  const updatedLocal = [newPatient, ...currentLocal];
  setLocalPatients(updatedLocal);

  return { ...newPatient, tempPassword };
}

export async function updatePatient(id: string, updates: Partial<Patient>): Promise<void> {
  try {
    const sanitizedUpdates = removeUndefined(updates);
    await updateDoc(doc(db, 'patients', id), sanitizedUpdates);
  } catch (error) {
    console.error('Failed to update patient in Firestore:', error);
  }

  const local = getLocalPatients();
  const updatedLocal = local.map((p) => (p.id === id ? { ...p, ...updates } : p));
  setLocalPatients(updatedLocal);
}

export async function deletePatient(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'patients', id));
  } catch (error) {
    console.error('Failed to delete patient from Firestore:', error);
  }

  const local = getLocalPatients();
  const updatedLocal = local.filter((p) => p.id !== id);
  setLocalPatients(updatedLocal);
}
