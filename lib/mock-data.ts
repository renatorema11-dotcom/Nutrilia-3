// Real data storage is managed via Firestore and lib/patients.ts
export const MOCK_PATIENT = {
  id: '',
  name: '',
  email: '',
  age: 0,
  targetWeight: 0,
  initialWeight: 0,
  objective: 'Saúde Geral',
  nextAppointment: '',
  measurements: [],
  currentPlan: null,
  pastPlans: []
};

export const MOCK_PATIENTS_LIST: any[] = [];

export const MOCK_NUTRITIONIST = {
  id: '',
  name: 'Nutricionista',
  email: '',
  alerts: []
};
