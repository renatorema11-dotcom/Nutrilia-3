'use client';

import { useEffect, useMemo, useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from '@/components/ui';
import {
  Calendar,
  Download,
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
import { format, isValid, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { handlePrintOrDownload } from '@/lib/print-utils';
import { useAuth } from '@/components/auth-provider';
import { PremiumButton, usePremium } from '@/components/premium';
import { getUserData, updateUserData } from '@/lib/db';
import { dailyKey, isSameDay } from '@/lib/daily-log';
import { mealsFromPlanText, planDayIndexForToday, planDayMeals, planDaysToMarkdown, planTextToMarkdown, type PlanMeal } from '@/lib/plan-text';

/** O que a pessoa marcou hoje, no mesmo registro do diário alimentar e das conquistas do dia. */
type DiaryEntries = Record<string, { status?: string | null; notes?: string; [key: string]: unknown }>;

const isDone = (entry: DiaryEntries[string] | undefined) => entry?.status === 'followed' || entry?.status === 'different';

function MealCard({ meal, done, onToggle }: { meal: PlanMeal; done: boolean; onToggle?: () => void }) {
  return (
    <div
      className={`p-4 rounded-xl border transition-all flex flex-col justify-between ${
        done
          ? 'bg-emerald-50/80 border-emerald-400 shadow-sm ring-1 ring-emerald-300'
          : 'bg-white border-slate-200 hover:border-emerald-200 shadow-2xs'
      }`}
    >
      <div className={`space-y-2 ${onToggle ? 'mb-4' : ''}`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center flex-wrap gap-2">
            <span className="font-bold text-slate-900 text-base">{meal.name}</span>
            {meal.time && (
              <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-100/80 px-2 py-0.5 rounded-full border border-emerald-200">
                {meal.time}
              </span>
            )}
          </div>
          {done && (
            <span className="inline-flex items-center gap-1 text-xs font-bold bg-emerald-600 text-white px-2.5 py-0.5 rounded-full shadow-xs shrink-0">
              <Check className="w-3.5 h-3.5" /> Realizada
            </span>
          )}
        </div>

        {meal.items.length > 0 && (
          <ul className="text-xs sm:text-sm text-slate-600 space-y-1 list-disc pl-4 pt-1">
            {meal.items.map((item, idx) => (
              <li key={idx} className={done ? 'line-through text-slate-500' : ''}>{item}</li>
            ))}
          </ul>
        )}
      </div>

      {onToggle && (
        <div className="pt-2 border-t border-slate-100 flex justify-end">
          <Button
            onClick={onToggle}
            className={`w-full sm:w-auto text-xs sm:text-sm font-semibold h-9 px-4 rounded-lg flex items-center justify-center gap-2 transition-all ${
              done
                ? 'bg-emerald-100 hover:bg-emerald-200 text-emerald-900 border border-emerald-300 shadow-2xs'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm'
            }`}
          >
            <CheckCircle2 className={`w-4 h-4 ${done ? 'text-emerald-700 fill-emerald-600/30' : ''}`} />
            {done ? '✓ Refeição realizada' : 'Refeição realizada'}
          </Button>
        </div>
      )}
    </div>
  );
}

function PlanCard({
  plan,
  entries,
  onToggleMeal
}: {
  plan: any;
  entries: DiaryEntries;
  onToggleMeal: (mealName: string) => void;
}) {
  const printRef = useRef<HTMLDivElement>(null);
  const [showFullDetails, setShowFullDetails] = useState(false);
  // Baixar o plano em PDF é do Premium; ver e marcar as refeições é de todos.
  const premium = usePremium();

  const days: any[] = useMemo(() => (Array.isArray(plan.days) ? plan.days : []), [plan.days]);
  const todayIndex = planDayIndexForToday(days);
  // Plano da nutricionista: as refeições de hoje são as do grupo de dias de hoje. Cardápio salvo: as que estão no texto.
  const meals = days.length ? planDayMeals(days[todayIndex]) : mealsFromPlanText(plan.content);
  const otherDays = days.filter((_, index) => index !== todayIndex);
  const fullText = days.length ? planDaysToMarkdown(days) : planTextToMarkdown(plan.content);

  const completedCount = meals.filter((meal) => isDone(entries[meal.name])).length;
  const progressPercent = meals.length > 0 ? Math.round((completedCount / meals.length) * 100) : 0;

  const onExport = () => {
    handlePrintOrDownload(printRef.current, 'Meu Plano Alimentar', fullText);
  };

  const date = parseISO(String(plan.date || ''));
  const formattedDate = isValid(date) ? format(date, "dd 'de' MMM, yyyy", { locale: ptBR }) : 'Ativo';

  return (
    <Card className="border-emerald-200 shadow-md transition-all">
      <CardHeader className="bg-emerald-50/70 border-b border-emerald-100 pb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-600 text-white rounded-lg shadow-sm">
            <Utensils className="w-5 h-5" />
          </div>
          <div>
            <CardTitle className="text-lg text-emerald-950 font-bold">
              {plan.title || `Cardápio criativo (${plan.objective || 'Saúde e nutrição'})`}
            </CardTitle>
            <p className="text-xs text-emerald-700">
              {days.length ? 'Marque as refeições de hoje' : 'Sugestão da IA, não substitui o plano da sua nutricionista'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="default" className="bg-white/90 border border-emerald-200 text-emerald-800">
            <Calendar className="w-3 h-3 mr-1 text-emerald-600" />
            {formattedDate}
          </Badge>
          {premium.active ? (
            <Button
              variant="outline"
              className="h-8 text-xs bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50"
              onClick={onExport}
            >
              <Download className="w-3 h-3 mr-1" /> Exportar
            </Button>
          ) : (
            <PremiumButton label="Exportar" className="h-8 text-xs" />
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-6 space-y-6">
        {meals.length > 0 && (
          <>
            <div className="bg-emerald-50/90 border border-emerald-200/80 rounded-xl p-4 sm:p-5 shadow-xs">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-emerald-600" />
                  <h4 className="font-bold text-emerald-950 text-sm sm:text-base">Progresso de hoje</h4>
                </div>
                <span className="text-xs sm:text-sm font-extrabold text-emerald-800 bg-white px-3 py-1 rounded-full border border-emerald-200 shadow-2xs">
                  {completedCount} de {meals.length} refeições realizadas ({progressPercent}%)
                </span>
              </div>

              <div className="w-full bg-emerald-200/80 rounded-full h-3 overflow-hidden p-0.5">
                <div
                  className="bg-emerald-600 h-full rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              {progressPercent === 100 && (
                <div className="mt-4 p-3 bg-emerald-600 text-white rounded-lg text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-sm">
                  <Award className="w-5 h-5 text-amber-300 shrink-0" />
                  <span>Parabéns! Você realizou todas as refeições de hoje! 🎉</span>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <Clock className="w-4 h-4 text-emerald-600" />
                Refeições de hoje{days.length > 1 && typeof days[todayIndex]?.name === 'string' ? ` (${days[todayIndex].name})` : ''}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {meals.map((meal) => (
                  <MealCard key={meal.id} meal={meal} done={isDone(entries[meal.name])} onToggle={() => onToggleMeal(meal.name)} />
                ))}
              </div>
            </div>
          </>
        )}

        {otherDays.map((day, index) => (
          <div key={index} className="space-y-4">
            <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wider">{typeof day?.name === 'string' && day.name ? day.name : 'Outros dias'}</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {planDayMeals(day).map((meal) => <MealCard key={meal.id} meal={meal} done={false} />)}
            </div>
          </div>
        ))}

        {/* O texto todo: aberto quando o cardápio não tem refeições separadas; é também o que vai para o PDF. */}
        <div ref={printRef} className="hidden"><Markdown>{fullText}</Markdown></div>
        {fullText && !days.length && (
          <div className="pt-4 border-t border-slate-100">
            {meals.length > 0 && (
              <button
                onClick={() => setShowFullDetails(!showFullDetails)}
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1 py-1"
              >
                {showFullDetails
                  ? <><ChevronUp className="w-4 h-4" /> Ocultar o cardápio completo</>
                  : <><ChevronDown className="w-4 h-4" /> Ver o cardápio completo</>}
              </button>
            )}

            {(showFullDetails || meals.length === 0) && (
              <div className="mt-3 markdown-body text-sm text-slate-700 space-y-3 bg-slate-50/70 rounded-xl border border-slate-200 p-5">
                <Markdown>{fullText}</Markdown>
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
  const [entries, setEntries] = useState<DiaryEntries>({});
  const [loaded, setLoaded] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    getUserData(user.uid).then((data) => {
      const now = new Date();
      if (data?.foodDiary && isSameDay(data.foodDiary.date, now, now.toLocaleDateString())) {
        setEntries(data.foodDiary.entries || {});
      }
      if (Array.isArray(data?.savedPlans)) {
        setSavedPlans(data.savedPlans.filter((plan: any) => plan && typeof plan === 'object' && 'id' in plan));
      }
      setCurrentPlan(data?.currentPlan || null);
      setLoaded(true);
    }).catch((error) => {
      console.error(error);
      setLoaded(true);
    });
  }, [user]);

  const handleToggleMeal = async (mealName: string) => {
    if (!user) return;
    const entry = entries[mealName];
    const next: DiaryEntries = { ...entries, [mealName]: { notes: '', ...entry, status: isDone(entry) ? null : 'followed' } };
    setEntries(next);
    await updateUserData(user.uid, { foodDiary: { entries: next, date: dailyKey() } });
  };

  if (!loaded) return null;

  const allPlans: any[] = [];
  if (currentPlan) {
    allPlans.push({
      id: currentPlan.id || 'prescribed_current',
      title: 'Plano da sua nutricionista',
      date: currentPlan.approvedAt || currentPlan.createdDate,
      days: currentPlan.days,
    });
  }
  allPlans.push(...savedPlans);

  if (allPlans.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-xl border border-slate-200 shadow-xs p-8 max-w-xl mx-auto my-8">
        <Utensils className="w-12 h-12 text-emerald-500 mx-auto mb-3 opacity-80" />
        <h2 className="text-xl font-bold text-slate-900">Você ainda não tem um plano alimentar</h2>
        <p className="text-slate-600 mt-2 text-sm">O plano aparece aqui assim que a sua nutricionista aprovar.</p>
        <p className="text-slate-500 text-xs mt-1">Enquanto isso, você pode gerar um cardápio criativo no Dashboard.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Meus Planos Alimentares</h1>
        <p className="text-slate-600 text-sm">
          Marque cada <strong className="text-emerald-700 font-semibold">Refeição realizada</strong> para acompanhar o seu dia. As marcações recomeçam a cada dia.
        </p>
      </div>

      <div className="space-y-8">
        {allPlans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            entries={entries}
            onToggleMeal={handleToggleMeal}
          />
        ))}
      </div>
    </div>
  );
}
