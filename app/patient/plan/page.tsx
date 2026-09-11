'use client';

import { useEffect, useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from '@/components/ui';
import { 
  Calendar, 
  Download, 
  FileText, 
  CheckCircle2, 
  Check, 
  Sparkles, 
  Award, 
  Clock, 
  ChevronDown, 
  ChevronUp,
  Utensils
} from 'lucide-react';
import Markdown from 'react-markdown';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { handlePrintOrDownload } from '@/lib/print-utils';
import { useAuth } from '@/components/auth-provider';
import { getUserData, updateUserData } from '@/lib/db';

interface MealSection {
  id: string;
  name: string;
  time?: string;
  items: string[];
}

function extractMealsFromPlan(plan: any): MealSection[] {
  // If plan has structured days/meals (e.g., prescribed by nutritionist)
  if (plan.days && Array.isArray(plan.days) && plan.days.length > 0) {
    const meals: MealSection[] = [];
    plan.days.forEach((day: any, dayIdx: number) => {
      if (day.meals && Array.isArray(day.meals)) {
        day.meals.forEach((m: any, mIdx: number) => {
          meals.push({
            id: m.id || `day_${dayIdx}_meal_${mIdx}`,
            name: m.name || `Refeição ${mIdx + 1}`,
            time: m.time || 'Horário flexível',
            items: Array.isArray(m.items) ? m.items : [m.items || 'Consulte o plano']
          });
        });
      }
    });
    if (meals.length > 0) return meals;
  }

  // If plan is markdown content (e.g. AI generated)
  const content = plan.content || '';
  if (!content) return [];

  const lines = content.split('\n');
  const meals: MealSection[] = [];
  let currentMeal: MealSection | null = null;

  const mealKeywords = ['café', 'desjejum', 'almoço', 'lanche', 'jantar', 'ceia', 'refeição', 'prato', 'opção'];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isHeading = /^#{1,4}\s+/.test(trimmed) || /^\*\*[^*]+\*\*/.test(trimmed) || /^\d+\.\s+/.test(trimmed);
    const cleanText = trimmed.replace(/^#{1,4}\s+/, '').replace(/\*\*/g, '').trim();
    const lowerClean = cleanText.toLowerCase();

    const containsKeyword = mealKeywords.some(kw => lowerClean.includes(kw));

    if (isHeading || containsKeyword) {
      // Look for a time string e.g. (08:00) or 08h
      const timeMatch = cleanText.match(/\(?\b(\d{1,2}[:h]\d{2}|\d{1,2}h)\b\)?/i);
      const time = timeMatch ? timeMatch[1] : undefined;
      const name = cleanText.replace(/\(?\b(\d{1,2}[:h]\d{2}|\d{1,2}h)\b\)?/gi, '').trim();

      if (name && name.length < 70 && name.length > 2) {
        if (currentMeal && (currentMeal.items.length > 0 || currentMeal.name)) {
          meals.push(currentMeal);
        }
        currentMeal = {
          id: name.toLowerCase().replace(/[^a-z0-9]/g, '_') || `meal_${meals.length}`,
          name: name,
          time: time || 'Horário flexível',
          items: []
        };
        continue;
      }
    }

    if (currentMeal) {
      if (trimmed.startsWith('-') || trimmed.startsWith('*') || trimmed.startsWith('•')) {
        currentMeal.items.push(trimmed.replace(/^[-*•]\s*/, ''));
      } else if (trimmed.length > 0 && !trimmed.startsWith('#') && !trimmed.startsWith('---')) {
        currentMeal.items.push(trimmed);
      }
    }
  }

  if (currentMeal && (currentMeal.items.length > 0 || currentMeal.name)) {
    meals.push(currentMeal);
  }

  // Fallback default meals if markdown had no structured headings
  if (meals.length === 0) {
    return [
      { id: 'm_cafe', name: 'Café da Manhã', time: '08:00', items: ['Refeição matinal conforme plano'] },
      { id: 'm_almoco', name: 'Almoço', time: '12:30', items: ['Refeição principal conforme plano'] },
      { id: 'm_lanche', name: 'Lanche da Tarde', time: '16:00', items: ['Lanche intermediário conforme plano'] },
      { id: 'm_jantar', name: 'Jantar', time: '19:30', items: ['Refeição noturna conforme plano'] },
    ];
  }

  return meals;
}

function PlanCard({ 
  plan, 
  completedMeals, 
  onToggleMeal 
}: { 
  plan: any; 
  completedMeals: Record<string, boolean>; 
  onToggleMeal: (planId: string, mealId: string) => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [showFullDetails, setShowFullDetails] = useState(false);

  const meals = extractMealsFromPlan(plan);
  const totalMeals = meals.length;

  const completedCount = meals.filter(m => {
    const key = `${plan.id}_${m.id}`;
    return !!completedMeals[key];
  }).length;

  const progressPercent = totalMeals > 0 ? Math.round((completedCount / totalMeals) * 100) : 0;

  const onExport = () => {
    handlePrintOrDownload(contentRef.current, 'Meu Plano Alimentar', plan.content || JSON.stringify(plan));
  };

  const formattedDate = plan.date || plan.createdDate
    ? format(parseISO(plan.date || plan.createdDate), "dd 'de' MMM, yyyy", { locale: ptBR })
    : 'Ativo';

  return (
    <Card className="border-emerald-200 shadow-md transition-all">
      <CardHeader className="bg-emerald-50/70 border-b border-emerald-100 pb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-600 text-white rounded-lg shadow-sm">
            <Utensils className="w-5 h-5" />
          </div>
          <div>
            <CardTitle className="text-lg text-emerald-950 font-bold">
              {plan.title || `Plano Alimentar (${plan.objective || 'Saúde & Nutrição'})`}
            </CardTitle>
            <p className="text-xs text-emerald-700">
              Acompanhe e marque suas refeições diariamente
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="default" className="bg-white/90 border border-emerald-200 text-emerald-800">
            <Calendar className="w-3 h-3 mr-1 text-emerald-600" />
            {formattedDate}
          </Badge>
          <Button 
            variant="outline" 
            className="h-8 text-xs bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50"
            onClick={onExport}
          >
            <Download className="w-3 h-3 mr-1" /> Exportar
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pt-6 space-y-6">
        {/* Progress Tracker Banner */}
        <div className="bg-emerald-50/90 border border-emerald-200/80 rounded-xl p-4 sm:p-5 shadow-xs">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-emerald-600" />
              <h4 className="font-bold text-emerald-950 text-sm sm:text-base">
                Progresso das Refeições
              </h4>
            </div>
            <span className="text-xs sm:text-sm font-extrabold text-emerald-800 bg-white px-3 py-1 rounded-full border border-emerald-200 shadow-2xs">
              {completedCount} de {totalMeals} refeições realizadas ({progressPercent}%)
            </span>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-emerald-200/80 rounded-full h-3 overflow-hidden p-0.5">
            <div 
              className="bg-emerald-600 h-full rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          {progressPercent === 100 && (
            <div className="mt-4 p-3 bg-emerald-600 text-white rounded-lg text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-sm animate-pulse">
              <Award className="w-5 h-5 text-amber-300 shrink-0" />
              <span>Parabéns! Você realizou todas as refeições deste plano hoje! 🎉</span>
            </div>
          )}
        </div>

        {/* Meal Cards Grid with "Refeição realizada" Buttons */}
        <div className="space-y-4">
          <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
            <Clock className="w-4 h-4 text-emerald-600" /> Refeições Programadas
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {meals.map((meal) => {
              const mealKey = `${plan.id}_${meal.id}`;
              const isDone = !!completedMeals[mealKey];

              return (
                <div 
                  key={meal.id} 
                  className={`p-4 rounded-xl border transition-all flex flex-col justify-between ${
                    isDone 
                      ? 'bg-emerald-50/80 border-emerald-400 shadow-sm ring-1 ring-emerald-300' 
                      : 'bg-white border-slate-200 hover:border-emerald-200 shadow-2xs'
                  }`}
                >
                  <div className="space-y-2 mb-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900 text-base">
                          {meal.name}
                        </span>
                        {meal.time && (
                          <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded-full border border-emerald-200">
                            {meal.time}
                          </span>
                        )}
                      </div>

                      {/* Visual Checkmark Badge */}
                      {isDone && (
                        <span className="inline-flex items-center gap-1 text-xs font-bold bg-emerald-600 text-white px-2.5 py-0.5 rounded-full shadow-xs shrink-0">
                          <Check className="w-3.5 h-3.5" /> Realizada
                        </span>
                      )}
                    </div>

                    {/* Meal Items */}
                    {meal.items.length > 0 && (
                      <ul className="text-xs sm:text-sm text-slate-600 space-y-1 list-disc list-inside pt-1">
                        {meal.items.map((item, idx) => (
                          <li key={idx} className={isDone ? 'line-through text-slate-500' : ''}>
                            {item}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* "Refeição realizada" Action Button */}
                  <div className="pt-2 border-t border-slate-100 flex justify-end">
                    <Button
                      onClick={() => onToggleMeal(plan.id, meal.id)}
                      className={`w-full sm:w-auto text-xs sm:text-sm font-semibold h-9 px-4 rounded-lg flex items-center justify-center gap-2 transition-all ${
                        isDone 
                          ? 'bg-emerald-100 hover:bg-emerald-200 text-emerald-900 border border-emerald-300 shadow-2xs' 
                          : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm'
                      }`}
                    >
                      <CheckCircle2 className={`w-4 h-4 ${isDone ? 'text-emerald-700 fill-emerald-600/30' : ''}`} />
                      {isDone ? '✓ Refeição realizada' : 'Refeição realizada'}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Detailed Plan Content (Markdown / Full View) */}
        {plan.content && (
          <div className="pt-4 border-t border-slate-100">
            <button
              onClick={() => setShowFullDetails(!showFullDetails)}
              className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 py-1"
            >
              {showFullDetails ? (
                <>
                  <ChevronUp className="w-4 h-4" /> Ocultar detalhes completos do plano
                </>
              ) : (
                <>
                  <ChevronDown className="w-4 h-4" /> Ver texto/orientações completas do plano
                </>
              )}
            </button>

            {showFullDetails && (
              <div 
                ref={contentRef} 
                className="mt-3 prose prose-teal max-w-none prose-sm sm:prose-base prose-headings:font-bold prose-h1:text-teal-900 prose-h1:text-xl prose-h2:text-teal-800 prose-h2:text-lg prose-p:text-slate-700 prose-li:text-slate-700 bg-slate-50/70 rounded-xl border border-slate-200 p-5"
              >
                <Markdown>{plan.content}</Markdown>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function PatientPlan() {
  const [savedPlans, setSavedPlans] = useState<any[]>([]);
  const [currentPlan, setCurrentPlan] = useState<any | null>(null);
  const [completedMeals, setCompletedMeals] = useState<Record<string, boolean>>({});
  const [isMounted, setIsMounted] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
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

        if (data?.completedMeals) {
          setCompletedMeals(data.completedMeals);
        }

        if (data?.savedPlans && isValidPlanFormat(data.savedPlans)) {
          setSavedPlans(data.savedPlans);
        }

        if (data?.currentPlan) {
          setCurrentPlan(data.currentPlan);
        } else if (data?.patientData?.currentPlan) {
          setCurrentPlan(data.patientData.currentPlan);
        }
      } else {
        const plansStr = localStorage.getItem('mockSavedPlans');
        if (plansStr && isValidPlanFormat(plansStr)) {
          setSavedPlans(JSON.parse(plansStr));
        }

        const completedStr = localStorage.getItem('completedMeals');
        if (completedStr) {
          try {
            setCompletedMeals(JSON.parse(completedStr));
          } catch (e) {
            console.error(e);
          }
        }

        const mockPatientDataStr = localStorage.getItem('mockPatientData');
        if (mockPatientDataStr) {
          try {
            const parsed = JSON.parse(mockPatientDataStr);
            if (parsed.currentPlan) setCurrentPlan(parsed.currentPlan);
          } catch (e) {
            console.error(e);
          }
        }
      }
    }

    loadData();
  }, [user]);

  const handleToggleMeal = async (planId: string, mealId: string) => {
    const key = `${planId}_${mealId}`;
    const newCompleted = {
      ...completedMeals,
      [key]: !completedMeals[key]
    };

    setCompletedMeals(newCompleted);

    if (user) {
      await updateUserData(user.uid, { completedMeals: newCompleted });
    } else {
      localStorage.setItem('completedMeals', JSON.stringify(newCompleted));
    }
  };

  if (!isMounted) {
    return null;
  }

  const allPlans: any[] = [];
  if (currentPlan) {
    allPlans.push({
      id: currentPlan.id || 'prescribed_current',
      title: 'Plano Prescrito pelo Nutricionista',
      date: currentPlan.createdDate || new Date().toISOString(),
      days: currentPlan.days,
      objective: 'Prescrição Oficial'
    });
  }

  savedPlans.forEach(p => {
    if (!allPlans.some(ap => ap.id === p.id)) {
      allPlans.push(p);
    }
  });

  if (allPlans.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-xl border border-slate-200 shadow-xs p-8 max-w-xl mx-auto my-8">
        <Utensils className="w-12 h-12 text-emerald-500 mx-auto mb-3 opacity-80" />
        <h2 className="text-xl font-bold text-slate-900">Nenhum plano ativo encontrado</h2>
        <p className="text-slate-600 mt-2 text-sm">Você ainda não possui planos alimentares ativos ou salvos.</p>
        <p className="text-slate-500 text-xs mt-1">Volte ao Dashboard para solicitar ou gerar seu primeiro plano alimentar!</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Meus Planos Alimentares</h1>
        <p className="text-slate-600 text-sm">
          Marque cada <strong className="text-emerald-700 font-semibold">Refeição realizada</strong> para acompanhar o seu progresso diário no plano.
        </p>
      </div>

      <div className="space-y-8">
        {allPlans.map((plan) => (
          <PlanCard 
            key={plan.id} 
            plan={plan} 
            completedMeals={completedMeals} 
            onToggleMeal={handleToggleMeal} 
          />
        ))}
      </div>
    </div>
  );
}
