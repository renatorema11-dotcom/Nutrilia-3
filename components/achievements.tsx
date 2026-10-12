'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Award, Target, Droplets } from 'lucide-react';
import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useAuth } from './auth-provider';
import { db } from '@/lib/firebase';
import { getUserData } from '@/lib/db';
import { WATER_GOAL_ML, mealsDoneToday, waterToday } from '@/lib/daily-log';

const liters = (ml: number) => `${(ml / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} L`;

/** Resumo do dia com o que o paciente marcou de verdade no copo d'água e no diário alimentar. */
export function Achievements() {
  const { user } = useAuth();
  const [loaded, setLoaded] = useState(false);
  const [water, setWater] = useState(0);
  // null enquanto o plano não foi lido: o cartão espera em vez de dizer "0 refeições".
  const [plannedMeals, setPlannedMeals] = useState<string[] | null>(null);
  const [mealsDone, setMealsDone] = useState(0);

  useEffect(() => {
    if (!user) return;
    let active = true;
    // As refeições do dia são as mesmas que o diário alimentar mostra.
    getUserData(user.uid)
      .then((data) => {
        const meals = data?.currentPlan?.days?.[0]?.meals;
        if (active) setPlannedMeals(Array.isArray(meals) ? meals.map((meal: { name: string }) => meal.name) : []);
      })
      .catch((error) => {
        console.error(error);
        if (active) setPlannedMeals([]);
      });
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user || !plannedMeals) return;
    // Mesmo registro que o copo d'água e o diário gravam: os números acompanham o que a pessoa marca.
    return onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
      const data = snapshot.data();
      const now = new Date();
      const legacy = now.toLocaleDateString();
      setWater(waterToday(data?.waterIntake, now, legacy));
      setMealsDone(mealsDoneToday(data?.foodDiary, plannedMeals, now, legacy));
      setLoaded(true);
    }, () => setLoaded(true));
  }, [user, plannedMeals]);

  if (!loaded || !plannedMeals) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center text-slate-800 text-base">
            <Award className="w-5 h-5 mr-2 text-amber-500" />
            Conquistas
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-6">
          <div className="w-8 h-8 rounded-full border-4 border-amber-200 border-t-amber-500 animate-spin"></div>
        </CardContent>
      </Card>
    );
  }

  const achievements = [
    {
      id: 1,
      title: 'Hidratação',
      description: `${liters(water)} de ${liters(WATER_GOAL_ML)}`,
      progress: Math.min(100, Math.round((water / WATER_GOAL_ML) * 100)),
      icon: <Droplets className="w-6 h-6 text-blue-500" />,
      color: 'bg-blue-500',
      bgColor: 'bg-blue-100',
    },
    {
      id: 2,
      title: 'Refeições',
      description: plannedMeals.length
        ? `${mealsDone} de ${plannedMeals.length} feitas`
        : 'Seu plano ainda não tem refeições para marcar',
      progress: plannedMeals.length ? Math.round((mealsDone / plannedMeals.length) * 100) : 0,
      icon: <Target className="w-6 h-6 text-emerald-500" />,
      color: 'bg-emerald-500',
      bgColor: 'bg-emerald-100',
    }
  ];

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center text-slate-800 text-base">
          <Award className="w-5 h-5 mr-2 text-amber-500" />
          Conquistas do Dia
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {achievements.map((item) => (
            <div key={item.id} className="flex flex-col p-4 rounded-xl border border-slate-100 bg-white shadow-sm hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start mb-3">
                <div className={`p-2 rounded-lg ${item.bgColor}`}>
                  {item.icon}
                </div>
                {item.progress === 100 && (
                  <span className="flex h-3 w-3 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                  </span>
                )}
              </div>
              <h4 className="font-semibold text-slate-800 text-sm">{item.title}</h4>
              <p className="text-xs text-slate-500 font-medium mb-3">{item.description}</p>

              <div className="w-full bg-slate-100 rounded-full h-2 mt-auto">
                <div
                  className={`h-2 rounded-full ${item.color} transition-all duration-1000 ease-out`}
                  style={{ width: `${item.progress}%` }}
                ></div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
