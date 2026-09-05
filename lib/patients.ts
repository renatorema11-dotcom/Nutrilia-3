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

/**
 * Limpa o cache legado de pacientes que era gravado no localStorage.
 * Dados de saúde não devem ficar persistidos no navegador — esta função
 * remove resíduos antigos das máquinas dos nutricionistas.
 */
const LEGACY_LOCAL_STORAGE_KEY = 'nutri_real_patients';
let legacyCachePurged = false;

function purgeLegacyLocalCache(): void {
  if (legacyCachePurged || typeof window === 'undefined') return;
  legacyCachePurged = true;
  try {
    localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
  } catch {
    // ignora — modo privado/navegador sem storage
  }
}

export async function getPatients(): Promise<Patient[]> {
  purgeLegacyLocalCache();

  const querySnapshot = await getDocs(collection(db, 'patients'));
  const patients: Patient[] = [];
  querySnapshot.forEach((docSnap) => {
    patients.push({ id: docSnap.id, ...docSnap.data() } as Patient);
  });
  return patients;
}

export async function getPatientById(id: string): Promise<Patient | null> {
  purgeLegacyLocalCache();

  const docRef = doc(db, 'patients', id);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return { id: docSnap.id, ...docSnap.data() } as Patient;
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

  return { ...newPatient, tempPassword };
}

export async function updatePatient(id: string, updates: Partial<Patient>): Promise<void> {
  const sanitizedUpdates = removeUndefined(updates);
  await updateDoc(doc(db, 'patients', id), sanitizedUpdates);
}

export async function deletePatient(id: string): Promise<void> {
  await deleteDoc(doc(db, 'patients', id));
}
