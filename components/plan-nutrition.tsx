'use client';

import { Calculator } from 'lucide-react';
import { dayTotals, mealTotals, planItemsNutrition, type PlanTotals } from '@/lib/plan-nutrition';

const n = (value: number) => value.toLocaleString('pt-BR');
const line = (t: PlanTotals) => `≈ ${n(t.kcal)} kcal · P ${n(t.protein)} g · C ${n(t.carbs)} g · G ${n(t.fat)} g`;
/** Por que o total pode estar abaixo do real: item fora da conta ou alimento em reavaliação na TACO. */
const gap = (t: PlanTotals) => (t.counted < t.items ? `${t.counted} de ${t.items} itens entraram na conta` : t.incomplete ? 'a TACO não traz todos os valores de algum alimento' : '');

/** Total estimado do dia (TACO). Só aparece em planos com o cálculo; planos antigos ficam como estavam. */
export function PlanDayTotals({ day }: { day: unknown }) {
  const totals = dayTotals(day);
  if (!totals) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-teal-100 bg-teal-50/70 px-3 py-2 text-xs text-teal-900">
      <Calculator className="w-4 h-4 mt-0.5 shrink-0 text-teal-600" />
      <div>
        <p className="font-semibold">Total do dia {line(totals)}</p>
        <p className="text-teal-800/80">
          Estimativa pela TACO com os pesos sugeridos pela IA; confira antes de aprovar.
          {gap(totals) ? ` Atenção: ${gap(totals)}.` : ''}
        </p>
      </div>
    </div>
  );
}

/** Total da refeição; ao abrir, mostra cada item com o alimento da TACO e o peso usados na conta. */
export function PlanMealTotals({ meal }: { meal: unknown }) {
  const totals = mealTotals(meal);
  if (!totals) return null;
  const rows = planItemsNutrition(meal);
  const items = Array.isArray((meal as { items?: unknown })?.items) ? (meal as { items: unknown[] }).items : [];
  return (
    <details className="mt-2 text-xs text-slate-600">
      <summary className="cursor-pointer select-none font-medium text-teal-700 hover:text-teal-800">
        {line(totals)}{gap(totals) ? ` (${gap(totals)})` : ''}
      </summary>
      <ul className="mt-2 space-y-1">
        {rows.map((row, i) => (
          <li key={i} className="break-words">
            {row ? (
              <>
                <span className="text-slate-700">{row.item}</span>
                {' → '}
                <span className="text-slate-500">{row.name}, {n(row.grams)} g</span>
                {row.kcal !== null && <span className="text-slate-700"> · {n(row.kcal)} kcal</span>}
              </>
            ) : (
              <span className="text-amber-700">{typeof items[i] === 'string' ? items[i] as string : 'Item'}: sem alimento correspondente na TACO, fora da conta</span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
