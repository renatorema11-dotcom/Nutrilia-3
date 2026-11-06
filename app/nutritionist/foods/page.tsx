'use client';

import { useMemo, useRef, useState } from 'react';
import { Apple, Info, Search, TriangleAlert } from 'lucide-react';
import { Card, CardContent } from '@/components/ui';
import { FOOD_NUTRIENTS, foodPortion, formatNutrient, searchFoods, type FoodItem, type NutrientGroup } from '@/lib/food-table';
import { TACO_CATEGORIES, TACO_SOURCE } from '@/lib/taco-foods';

const QUICK_GRAMS = [50, 100, 150, 200];
const GROUPS: NutrientGroup[] = ['Principais', 'Gorduras', 'Minerais', 'Vitaminas'];
const EXAMPLES = ['feijão preto', 'peito de frango', 'banana prata', 'arroz integral', 'ovo cozido'];

const shortValue = (value: number | 'Tr' | null) => (typeof value === 'number' ? value.toLocaleString('pt-BR') : value === 'Tr' ? 'tr' : '—');

/** Tabela de alimentos da nutricionista: busca na TACO e calcula os nutrientes para a porção digitada. */
export default function FoodTablePage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState<FoodItem | null>(null);
  const [grams, setGrams] = useState('100');
  const detailRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => searchFoods(query, { category: category || undefined, limit: 40 }), [query, category]);
  const portionGrams = Math.min(Math.max(Number(grams.replace(',', '.')) || 0, 0), 5000);
  const portion = selected ? foodPortion(selected, portionGrams) : null;
  const searching = query.trim() !== '' || category !== '';

  const choose = (food: FoodItem) => {
    setSelected(food);
    // No celular a ficha fica abaixo da lista: leva a tela até ela.
    if (window.matchMedia('(max-width: 1023px)').matches) setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-teal-700 font-semibold text-xs uppercase tracking-wider mb-1">
          <Apple className="w-4 h-4" /> Tabela de alimentos
        </div>
        <h1 className="text-2xl font-bold text-slate-800">Composição dos alimentos</h1>
        <p className="text-sm text-slate-600">597 alimentos brasileiros da TACO (Unicamp), com valores por 100 g e calculadora de porção.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-6 items-start">
        <Card className="bg-white">
          <CardContent className="p-4 sm:p-5 space-y-4">
            <div className="flex flex-col gap-2">
              <label className="relative flex-1">
                <span className="sr-only">Buscar alimento</span>
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar alimento (ex.: feijão preto)"
                  className="w-full rounded-lg bg-white border border-slate-200 pl-9 pr-3 py-2 text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                />
              </label>
              <label>
                <span className="sr-only">Categoria</span>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full rounded-lg bg-white border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                >
                  <option value="">Todas as categorias</option>
                  {TACO_CATEGORIES.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
            </div>

            {!searching ? (
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-sm text-slate-600 space-y-3">
                <p>Digite o nome do alimento (acento é opcional) ou escolha uma categoria.</p>
                <div className="flex flex-wrap gap-2">
                  {EXAMPLES.map((example) => (
                    <button key={example} type="button" onClick={() => setQuery(example)}
                      className="rounded-full border border-teal-200 bg-white px-3 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50">
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            ) : results.length === 0 ? (
              <p className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-sm text-slate-600">
                Nenhum alimento encontrado. A TACO traz alimentos in natura e preparações básicas; produtos de marca e suplementos não fazem parte dela.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 max-h-[60vh] overflow-y-auto -mx-1">
                {results.map((food) => (
                  <li key={food.id}>
                    <button
                      type="button"
                      onClick={() => choose(food)}
                      aria-pressed={selected?.id === food.id}
                      className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors ${selected?.id === food.id ? 'bg-teal-50' : 'hover:bg-slate-50'}`}
                    >
                      <span className="block text-sm font-semibold text-slate-800 break-words">{food.name}</span>
                      <span className="block text-xs text-slate-500">
                        {food.underReview && typeof food.values.kcal !== 'number'
                          ? 'Valores em reavaliação pela TACO'
                          : `${shortValue(food.values.kcal)} kcal · P ${shortValue(food.values.protein)} · C ${shortValue(food.values.carbs)} · G ${shortValue(food.values.fat)} (100 g)`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div ref={detailRef} className="scroll-mt-20">
          {!selected || !portion ? (
            <Card className="bg-white">
              <CardContent className="p-6 text-center text-sm text-slate-600 space-y-2">
                <Apple className="w-8 h-8 text-teal-600 mx-auto" />
                <p>Escolha um alimento na lista para ver a composição completa e calcular a porção.</p>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-white">
              <CardContent className="p-4 sm:p-5 space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-800 break-words">{selected.name}</h2>
                  <p className="text-xs text-slate-500">{selected.category} · TACO nº {selected.id}</p>
                </div>

                {selected.underReview && (
                  <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                    A própria TACO marca este alimento com análises em reavaliação. Os valores que aparecem como &quot;—&quot; não são zero: só não estão na tabela.
                  </p>
                )}

                <div className="space-y-2">
                  <label htmlFor="portion-grams" className="block text-sm font-medium text-slate-700">Porção (gramas)</label>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      id="portion-grams"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={5000}
                      value={grams}
                      onChange={(e) => setGrams(e.target.value)}
                      className="w-28 rounded-lg bg-white border border-slate-200 px-3 py-2 text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                    />
                    {QUICK_GRAMS.map((value) => (
                      <button key={value} type="button" onClick={() => setGrams(String(value))}
                        className={`rounded-full border px-3 py-1 text-xs font-medium ${portionGrams === value ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
                        {value} g
                      </button>
                    ))}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                        <th className="py-2 pr-2 font-semibold">Nutriente</th>
                        <th className="py-2 px-2 font-semibold text-right">100 g</th>
                        <th className="py-2 pl-2 font-semibold text-right">{portionGrams.toLocaleString('pt-BR')} g</th>
                      </tr>
                    </thead>
                    {GROUPS.map((group) => (
                      <tbody key={group} className="border-t border-slate-100">
                        <tr><th colSpan={3} className="pt-3 pb-1 text-left text-xs font-bold text-teal-700">{group}</th></tr>
                        {FOOD_NUTRIENTS.filter((n) => n.group === group).map((n) => (
                          <tr key={n.key} className={n.key === 'kcal' ? 'font-semibold text-slate-900' : 'text-slate-700'}>
                            <td className="py-1 pr-2">{n.label}</td>
                            <td className="py-1 px-2 text-right whitespace-nowrap">{formatNutrient(selected.values[n.key], n.unit)}</td>
                            <td className="py-1 pl-2 text-right whitespace-nowrap">{formatNutrient(portion[n.key], n.unit)}</td>
                          </tr>
                        ))}
                      </tbody>
                    ))}
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <p className="flex items-start gap-2 text-xs text-slate-500">
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          Valores por 100 g de parte comestível. &quot;—&quot;: a TACO não traz o valor (não analisado ou não se aplica). &quot;traços&quot;: presente em quantidade mínima.
          Fonte: {TACO_SOURCE}
        </span>
      </p>
    </div>
  );
}
