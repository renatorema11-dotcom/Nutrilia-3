const fs = require('fs');

const filesToUpdate = [
  'components/water-tracker.tsx',
  'components/mood-diary.tsx',
  'components/patient-settings.tsx',
  'components/appointment-scheduler.tsx',
  'components/food-diary.tsx',
  'components/evolution-chart.tsx',
  'components/guided-tour.tsx',
  'app/patient/plan/page.tsx',
  'app/patient/page.tsx',
  'app/onboarding/page.tsx',
  'app/register/page.tsx'
];

function read(f) {
  return fs.readFileSync(f, 'utf8');
}
function write(f, d) {
  fs.writeFileSync(f, d);
}

// water-tracker
let water = read('components/water-tracker.tsx');
water = water.replace("import { motion } from 'motion/react';", "import { motion } from 'motion/react';\nimport { useAuth } from './auth-provider';\nimport { getUserData, updateUserData } from '@/lib/db';");
water = water.replace("const goal = 2000; // 2L", "const goal = 2000; // 2L\n  const { user } = useAuth();");
water = water.replace(/useEffect\(\(\) => \{[\s\S]*?\}, \[\]\);/m, `useEffect(() => {
    setIsMounted(true);
    async function loadData() {
      if (user) {
        const data = await getUserData(user.uid);
        if (data?.waterIntake?.date === new Date().toLocaleDateString()) {
          setWater(data.waterIntake.amount || 0);
        } else {
          setWater(0);
        }
      } else {
        const saved = localStorage.getItem('mockWaterIntake');
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (parsed.date === new Date().toLocaleDateString()) {
              setWater(parsed.amount);
            }
          } catch (e) {
            console.error(e);
          }
        }
      }
    }
    loadData();
  }, [user]);`);
water = water.replace(/const addWater = \(amount: number\) => \{[\s\S]*?\}\)\);\n  \};/m, `const addWater = async (amount: number) => {
    const newWater = Math.min(water + amount, goal * 3);
    setWater(newWater);
    if (user) {
      await updateUserData(user.uid, {
        waterIntake: {
          amount: newWater,
          date: new Date().toLocaleDateString()
        }
      });
    } else {
      localStorage.setItem('mockWaterIntake', JSON.stringify({
        amount: newWater,
        date: new Date().toLocaleDateString()
      }));
    }
  };`);
write('components/water-tracker.tsx', water);

// mood-diary
let mood = read('components/mood-diary.tsx');
mood = mood.replace("import { cn } from '@/lib/utils';", "import { cn } from '@/lib/utils';\nimport { useAuth } from './auth-provider';\nimport { getUserData, updateUserData } from '@/lib/db';");
mood = mood.replace("const [isMounted, setIsMounted] = useState(false);", "const [isMounted, setIsMounted] = useState(false);\n  const { user } = useAuth();");
mood = mood.replace(/useEffect\(\(\) => \{[\s\S]*?\}, \[\]\);/m, `useEffect(() => {
    setIsMounted(true);
    async function loadData() {
      if (user) {
        const data = await getUserData(user.uid);
        if (data?.moodDiary?.date === new Date().toLocaleDateString()) {
          setSelectedMood(data.moodDiary.mood);
        }
      } else {
        const saved = localStorage.getItem('mockMoodDiary');
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (parsed.date === new Date().toLocaleDateString()) {
              setSelectedMood(parsed.mood);
            }
          } catch (e) {
            console.error(e);
          }
        }
      }
    }
    loadData();
  }, [user]);`);
mood = mood.replace(/const handleSelectMood = \(mood: Mood\) => \{[\s\S]*?\}\)\);\n  \};/m, `const handleSelectMood = async (mood: Mood) => {
    setSelectedMood(mood);
    if (user) {
      await updateUserData(user.uid, {
        moodDiary: {
          mood,
          date: new Date().toLocaleDateString()
        }
      });
    } else {
      localStorage.setItem('mockMoodDiary', JSON.stringify({
        mood,
        date: new Date().toLocaleDateString()
      }));
    }
  };`);
write('components/mood-diary.tsx', mood);

// patient-settings
let patset = read('components/patient-settings.tsx');
patset = patset.replace("import { Save, AlertCircle } from 'lucide-react';", "import { Save, AlertCircle } from 'lucide-react';\nimport { useAuth } from './auth-provider';\nimport { getUserData, updateUserData } from '@/lib/db';");
patset = patset.replace("patientData: any; \n  onSave: (newData: any) => void;\n}) {", "patientData: any; \n  onSave: (newData: any) => void;\n}) {\n  const { user } = useAuth();");
patset = patset.replace(/const handleSubmit = \(e: React\.FormEvent\) => \{[\s\S]*?setSuccessMsg\('Dados atualizados com sucesso!'\);\n    setTimeout\(\(\) => setSuccessMsg\(''\), 3000\);\n    onSave\(formData\);\n  \};/m, `const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    
    if (user) {
      const data = await getUserData(user.uid);
      const history = data?.patientHistory || [];
      if (history.length > 0) {
        history[history.length - 1].weight = parseFloat(formData.weight);
      }
      
      await updateUserData(user.uid, {
        patientData: formData,
        patientHistory: history
      });
    } else {
      localStorage.setItem('mockPatientData', JSON.stringify(formData));
      const savedHistory = localStorage.getItem('mockPatientHistory');
      if (savedHistory) {
        try {
          const history = JSON.parse(savedHistory);
          if (history.length > 0) {
            history[history.length - 1].weight = parseFloat(formData.weight);
            localStorage.setItem('mockPatientHistory', JSON.stringify(history));
          }
        } catch (err) {}
      }
    }

    setSuccessMsg('Dados atualizados com sucesso!');
    setTimeout(() => setSuccessMsg(''), 3000);
    onSave(formData);
  };`);
write('components/patient-settings.tsx', patset);

// appointment-scheduler
let appt = read('components/appointment-scheduler.tsx');
appt = appt.replace("import { ptBR } from 'date-fns/locale';", "import { ptBR } from 'date-fns/locale';\nimport { useAuth } from './auth-provider';\nimport { getUserData, updateUserData } from '@/lib/db';");
appt = appt.replace("const [isFormOpen, setIsFormOpen] = useState(false);", "const [isFormOpen, setIsFormOpen] = useState(false);\n  const { user } = useAuth();");
appt = appt.replace(/useEffect\(\(\) => \{[\s\S]*?\}, \[\]\);/m, `useEffect(() => {
    async function loadData() {
      if (user) {
        const data = await getUserData(user.uid);
        if (data?.appointments) {
          setAppointments(data.appointments);
        } else {
          setAppointments([]);
        }
      } else {
        const saved = localStorage.getItem('mockAppointments');
        if (saved) {
          try {
            setAppointments(JSON.parse(saved));
          } catch (e) {
            console.error(e);
          }
        }
      }
    }
    loadData();
  }, [user]);`);
appt = appt.replace(/const saveAppointments = \(newAppts: Appointment\[\]\) => \{[\s\S]*?\};/m, `const saveAppointments = async (newAppts: Appointment[]) => {
    setAppointments(newAppts);
    if (user) {
      await updateUserData(user.uid, { appointments: newAppts });
    } else {
      localStorage.setItem('mockAppointments', JSON.stringify(newAppts));
    }
  };`);
write('components/appointment-scheduler.tsx', appt);

// food-diary
let food = read('components/food-diary.tsx');
food = food.replace("import { Button } from '@/components/ui';", "import { Button } from '@/components/ui';\nimport { useAuth } from './auth-provider';\nimport { getUserData, updateUserData } from '@/lib/db';");
food = food.replace("const fileInputRef = useRef<HTMLInputElement>(null);", "const fileInputRef = useRef<HTMLInputElement>(null);\n  const { user } = useAuth();");
food = food.replace(/useEffect\(\(\) => \{[\s\S]*?\}, \[\]\);/m, `useEffect(() => {
    setIsMounted(true);
    async function loadData() {
      if (user) {
        const data = await getUserData(user.uid);
        if (data?.savedPlans && data.savedPlans.length > 0) {
          setHasPlan(true);
        }
        if (data?.foodDiary?.date === new Date().toLocaleDateString()) {
          setEntries(data.foodDiary.entries || {});
        }
      } else {
        const savedPlans = localStorage.getItem('mockSavedPlans');
        if (savedPlans && JSON.parse(savedPlans).length > 0) {
          setHasPlan(true);
        }
        const saved = localStorage.getItem('mockFoodDiary');
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (parsed.date === new Date().toLocaleDateString()) {
              setEntries(parsed.entries || {});
            }
          } catch (e) {
            console.error(e);
          }
        }
      }
    }
    loadData();
  }, [user]);`);
food = food.replace(/const saveEntries = \(newEntries: Record<string, MealEntry>\) => \{[\s\S]*?\};/m, `const saveEntries = async (newEntries: Record<string, MealEntry>) => {
    setEntries(newEntries);
    if (user) {
      await updateUserData(user.uid, {
        foodDiary: {
          entries: newEntries,
          date: new Date().toLocaleDateString()
        }
      });
    } else {
      localStorage.setItem('mockFoodDiary', JSON.stringify({
        entries: newEntries,
        date: new Date().toLocaleDateString()
      }));
    }
  };`);
food = food.replace(/setEntries\(prev => \{[\s\S]*?return updated;\n      \}\);/m, `let updatedEntries: Record<string, MealEntry> = {};
      setEntries(prev => {
        const updated = { ...prev };
        if (updated[mealName]) {
          updated[mealName].aiFeedback = data.feedback;
          updated[mealName].aiStatus = data.status;
        }
        updatedEntries = updated;
        return updated;
      });
      
      if (user) {
        await updateUserData(user.uid, {
          foodDiary: {
            entries: updatedEntries,
            date: new Date().toLocaleDateString()
          }
        });
      } else {
        localStorage.setItem('mockFoodDiary', JSON.stringify({
          entries: updatedEntries,
          date: new Date().toLocaleDateString()
        }));
      }`);
write('components/food-diary.tsx', food);

// evolution-chart
let evo = read('components/evolution-chart.tsx');
evo = evo.replace("import {", "import { useAuth } from './auth-provider';\nimport { getUserData, updateUserData } from '@/lib/db';\nimport {");
evo = evo.replace("const [data, setData] = useState<any[]>([]);", "const [data, setData] = useState<any[]>([]);\n  const { user } = useAuth();");
evo = evo.replace(/useEffect\(\(\) => \{[\s\S]*?\}, \[\]\);/m, `useEffect(() => {
    async function loadData() {
      if (user) {
        const dbData = await getUserData(user.uid);
        if (dbData?.patientData) {
          const currentWeight = parseFloat(dbData.patientData.weight);
          if (dbData.patientHistory) {
            setData(dbData.patientHistory);
          } else {
            const mockHistory = [
              { month: 'Jan', weight: currentWeight + 3.2, fat: 24.5 },
              { month: 'Fev', weight: currentWeight + 2.1, fat: 23.2 },
              { month: 'Mar', weight: currentWeight + 0.8, fat: 22.0 },
              { month: 'Abr', weight: currentWeight, fat: 21.1 },
            ];
            await updateUserData(user.uid, { patientHistory: mockHistory });
            setData(mockHistory);
          }
        }
      } else {
        const savedData = localStorage.getItem('mockPatientData');
        if (savedData) {
          const patient = JSON.parse(savedData);
          const currentWeight = parseFloat(patient.weight);
          
          const savedHistory = localStorage.getItem('mockPatientHistory');
          if (savedHistory) {
            setData(JSON.parse(savedHistory));
          } else {
            const mockHistory = [
              { month: 'Jan', weight: currentWeight + 3.2, fat: 24.5 },
              { month: 'Fev', weight: currentWeight + 2.1, fat: 23.2 },
              { month: 'Mar', weight: currentWeight + 0.8, fat: 22.0 },
              { month: 'Abr', weight: currentWeight, fat: 21.1 },
            ];
            localStorage.setItem('mockPatientHistory', JSON.stringify(mockHistory));
            setData(mockHistory);
          }
        }
      }
    }
    loadData();
  }, [user]);`);
write('components/evolution-chart.tsx', evo);

// guided-tour
let tour = read('components/guided-tour.tsx');
tour = tour.replace("import { Step } from 'react-joyride';", "import { Step } from 'react-joyride';\nimport { useAuth } from './auth-provider';\nimport { getUserData, updateUserData } from '@/lib/db';");
tour = tour.replace("const [run, setRun] = useState(false);", "const [run, setRun] = useState(false);\n  const { user } = useAuth();");
tour = tour.replace(/useEffect\(\(\) => \{[\s\S]*?\}, \[\]\);/m, `useEffect(() => {
    async function checkTour() {
      if (user) {
        const data = await getUserData(user.uid);
        if (!data?.hasSeenTour) {
          const timer = setTimeout(() => setRun(true), 1000);
          return () => clearTimeout(timer);
        }
      } else {
        const hasSeenTour = localStorage.getItem('hasSeenTour');
        if (!hasSeenTour) {
          const timer = setTimeout(() => setRun(true), 1000);
          return () => clearTimeout(timer);
        }
      }
    }
    checkTour();
  }, [user]);`);
tour = tour.replace(/const handleJoyrideCallback = \(data: any\) => \{[\s\S]*?\};/m, `const handleJoyrideCallback = async (data: any) => {
    const { status } = data;
    const finishedStatuses: string[] = ['finished', 'skipped'];
    if (finishedStatuses.includes(status)) {
      setRun(false);
      if (user) {
        await updateUserData(user.uid, { hasSeenTour: true });
      } else {
        localStorage.setItem('hasSeenTour', 'true');
      }
    }
  };`);
write('components/guided-tour.tsx', tour);

// patient plan page
let planPage = read('app/patient/plan/page.tsx');
planPage = planPage.replace("import { useReactToPrint } from 'react-to-print';", "import { useReactToPrint } from 'react-to-print';\nimport { useAuth } from '@/components/auth-provider';\nimport { getUserData } from '@/lib/db';");
planPage = planPage.replace("const [isMounted, setIsMounted] = useState(false);", "const [isMounted, setIsMounted] = useState(false);\n  const { user } = useAuth();");
planPage = planPage.replace(/useEffect\(\(\) => \{[\s\S]*?\}, \[\]\);/m, `useEffect(() => {
    setIsMounted(true);

    const isValidPlanFormat = (data: any) => {
      try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        if (!Array.isArray(parsed)) return false;
        return parsed.every(plan => plan && typeof plan === 'object' && 'id' in plan);
      } catch {
        return false;
      }
    };

    async function loadData() {
      if (user) {
        const data = await getUserData(user.uid);
        if (data?.savedPlans && isValidPlanFormat(data.savedPlans)) {
          setSavedPlans(data.savedPlans);
        }
      } else {
        const plansStr = localStorage.getItem('mockSavedPlans');
        if (plansStr) {
          if (isValidPlanFormat(plansStr)) {
            setSavedPlans(JSON.parse(plansStr));
          } else {
            console.error('Invalid saved plans format in localStorage');
          }
        }
      }
    }
    loadData();
  }, [user]);`);
write('app/patient/plan/page.tsx', planPage);

// patient dashboard
let patdash = read('app/patient/page.tsx');
patdash = patdash.replace("import { Achievements } from '@/components/achievements';", "import { Achievements } from '@/components/achievements';\nimport { useAuth } from '@/components/auth-provider';\nimport { getUserData, updateUserData } from '@/lib/db';");
patdash = patdash.replace("const router = useRouter();", "const router = useRouter();\n  const { user } = useAuth();");
patdash = patdash.replace(/useEffect\(\(\) => \{[\s\S]*?\}, \[\]\);/m, `useEffect(() => {
    const isValidPlanFormat = (data: any) => {
      try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        if (!Array.isArray(parsed)) return false;
        return parsed.every((plan: any) => plan && typeof plan === 'object' && 'id' in plan);
      } catch {
        return false;
      }
    };

    async function loadData() {
      if (user) {
        const data = await getUserData(user.uid);
        if (data?.savedPlans && isValidPlanFormat(data.savedPlans) && data.savedPlans.length > 0) {
          setHasPlan(true);
        }
        if (data?.patientData) {
          setPatientData(data.patientData);
        } else {
          setPatientData({
            name: MOCK_PATIENT.name,
            age: 32,
            weight: 70,
            height: 165,
            initialWeight: MOCK_PATIENT.initialWeight || 75,
            targetWeight: MOCK_PATIENT.targetWeight || 65,
            objective: 'Emagrecimento'
          });
        }
      } else {
        const savedPlans = localStorage.getItem('mockSavedPlans');
        if (savedPlans && isValidPlanFormat(savedPlans) && JSON.parse(savedPlans).length > 0) {
          setHasPlan(true);
        }

        const saved = localStorage.getItem('mockPatientData');
        if (saved) {
          setPatientData(JSON.parse(saved));
        } else {
          setPatientData({
            name: MOCK_PATIENT.name,
            age: 32,
            weight: 70,
            height: 165,
            initialWeight: MOCK_PATIENT.initialWeight || 75,
            targetWeight: MOCK_PATIENT.targetWeight || 65,
            objective: 'Emagrecimento'
          });
        }
      }
    }
    loadData();
  }, [user]);`);
patdash = patdash.replace(/const savePlan = \(\) => \{[\s\S]*?router\.push\('\/patient\/plan'\);\n    \} catch \(error\) \{/m, `const savePlan = async () => {
    setIsSaving(true);
    try {
      const newPlan = {
        id: Date.now().toString(),
        date: new Date().toISOString(),
        days: aiDraft.days,
        objective: patientData.objective
      };
      
      if (user) {
        const data = await getUserData(user.uid);
        const savedPlans = data?.savedPlans || [];
        savedPlans.unshift(newPlan);
        await updateUserData(user.uid, { savedPlans });
      } else {
        const savedPlansStr = localStorage.getItem('mockSavedPlans');
        const savedPlans = savedPlansStr ? JSON.parse(savedPlansStr) : [];
        savedPlans.unshift(newPlan);
        localStorage.setItem('mockSavedPlans', JSON.stringify(savedPlans));
      }
      
      router.push('/patient/plan');
    } catch (error) {`);
write('app/patient/page.tsx', patdash);

// onboarding
let onb = read('app/onboarding/page.tsx');
onb = onb.replace("import { motion, Variants } from 'motion/react';", "import { motion, Variants } from 'motion/react';\nimport { useAuth } from '@/components/auth-provider';\nimport { updateUserData } from '@/lib/db';");
onb = onb.replace("const router = useRouter();", "const router = useRouter();\n  const { user } = useAuth();");
onb = onb.replace(/const handleSubmit = \(e: React\.FormEvent\) => \{[\s\S]*?router\.push\('\/patient'\);\n  \};/m, `const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    
    if (user) {
      await updateUserData(user.uid, { patientData: formData });
    } else {
      localStorage.setItem('mockPatientData', JSON.stringify(formData));
    }
    router.push('/patient');
  };`);
write('app/onboarding/page.tsx', onb);

