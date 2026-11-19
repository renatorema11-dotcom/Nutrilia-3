// As planilhas da nutricionista (lista de pacientes, evolução do peso, plano alimentar com as contas da TACO e agenda),
// montadas como colunas e linhas. Servem às duas saídas: o Google Planilhas, que a Ali cria (lib/spreadsheets.ts), e o
// arquivo do Excel que as telas do app baixam (lib/xlsx.ts). Sem banco e sem segredos: roda no servidor e no navegador.
import { dayTotals, mealTotals, planItemsNutrition } from './plan-nutrition';
import type { PlanTotals } from './plan-nutrition';

export type ColumnType = 'text' | 'number' | 'decimal' | 'date';
export interface SheetColumn { title: string; type: ColumnType; width?: number }
export type SheetValue = string | number | null;

export interface SheetSpec {
  /** Nome do arquivo (no Google Planilhas ou no download do Excel). */
  title: string;
  /** Nome da aba. */
  tab: string;
  columns: SheetColumn[];
  rows: SheetValue[][];
  /** Linhas em negrito (totais), pelo índice em rows. */
  boldRows?: number[];
  /** Gráfico de linha: coluna do eixo horizontal e coluna dos valores (índices em columns). Só no Google Planilhas. */
  chart?: { title: string; x: number; y: number };
}

export const MAX_SHEET_ROWS = 2000;

const SHEET_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-10-19" → número de dias que o Google Planilhas e o Excel usam para datas (contados de 30/12/1899). */
export function sheetDateSerial(key: string): number | null {
  const m = SHEET_DATE_RE.exec(key);
  if (!m) return null;
  const time = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const back = new Date(time);
  if (back.getUTCMonth() !== Number(m[2]) - 1 || back.getUTCDate() !== Number(m[3])) return null;
  return Math.round((time - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/** "19/10/2026", a partir de uma data AAAA-MM-DD (para os títulos). */
export const brDate = (key: string) => (SHEET_DATE_RE.test(key) ? key.split('-').reverse().join('/') : key);

/** Dia AAAA-MM-DD de um instante, no fuso pedido. */
export const sheetDateKey = (date: Date, timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

/** Nome de arquivo sem os caracteres que o Windows e o macOS não aceitam. */
export const sheetFileName = (title: string, extension: string) => `${title.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 150)}.${extension}`;

const round1 = (value: number) => Math.round(value * 10) / 10;
const numberOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

// ───────────── Lista de pacientes ─────────────

export interface PatientSheetRow {
  name: string;
  email: string | null;
  objective: string;
  initialWeight: number | null;
  weight: number | null;
  targetWeight: number | null;
  lastMeasurement: string;
  nextAppointment: string;
  plan: 'approved' | 'draft' | 'none';
  pendingDraft: boolean;
  /** Data AAAA-MM-DD do último acesso; 'never' = nunca entrou; '' = sem a informação. */
  lastSeen: string;
  since: string;
}

export interface WeightEntry { date: string; weight: number; bodyFat: number | null; source: string }

/** Medições com data e peso válidos (com a gordura e quem registrou), da mais antiga para a mais recente. */
export function weightEntriesOf(data: Record<string, unknown>): WeightEntry[] {
  return (Array.isArray(data.measurements) ? data.measurements : [])
    .filter((m: Record<string, unknown>) => m && typeof m.date === 'string' && SHEET_DATE_RE.test(m.date) && typeof m.weight === 'number')
    .map((m: Record<string, unknown>) => ({ date: m.date as string, weight: m.weight as number, bodyFat: numberOrNull(m.bodyFat), source: typeof m.source === 'string' ? m.source : '' }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Uma linha da lista de pacientes, a partir do prontuário gravado (o mesmo no servidor e na tela). */
export function patientSheetRowOf(data: Record<string, unknown>, timeZone: string, lastSeen = ''): PatientSheetRow {
  const measures = weightEntriesOf(data);
  const last = measures.length ? measures[measures.length - 1] : null;
  const currentPlan = data.currentPlan && typeof data.currentPlan === 'object' ? data.currentPlan as { status?: unknown } : null;
  const created = typeof data.createdAt === 'string' ? new Date(data.createdAt) : null;
  return {
    name: typeof data.name === 'string' ? data.name.trim() : '',
    email: typeof data.email === 'string' && data.email.includes('@') ? data.email.trim() : null,
    objective: typeof data.objective === 'string' ? data.objective : '',
    initialWeight: numberOrNull(data.initialWeight) ?? (measures.length ? measures[0].weight : null),
    weight: last ? last.weight : numberOrNull(data.weight),
    targetWeight: numberOrNull(data.targetWeight),
    lastMeasurement: last ? last.date : '',
    nextAppointment: typeof data.nextAppointment === 'string' ? data.nextAppointment : '',
    plan: currentPlan?.status === 'approved' ? 'approved' : currentPlan?.status ? 'draft' : 'none',
    pendingDraft: !!data.pendingPlan && typeof data.pendingPlan === 'object',
    lastSeen,
    since: created && Number.isFinite(created.getTime()) ? sheetDateKey(created, timeZone) : '',
  };
}

const planLabel = (row: { plan: PatientSheetRow['plan']; pendingDraft: boolean }) => (row.plan === 'approved'
  ? (row.pendingDraft ? 'Aprovado (rascunho novo esperando)' : 'Aprovado')
  : row.plan === 'draft' ? 'Rascunho esperando aprovação' : 'Sem plano');

/** Sem withLastSeen (na tela do app), a coluna do último acesso fica de fora: só o servidor sabe essa informação. */
export function patientsSheet(rows: PatientSheetRow[], today: string, { withLastSeen = true } = {}): SheetSpec {
  const columns: SheetColumn[] = [
    { title: 'Nome', type: 'text', width: 200 }, { title: 'E-mail', type: 'text', width: 200 }, { title: 'Objetivo', type: 'text', width: 160 },
    { title: 'Peso inicial (kg)', type: 'decimal', width: 110 }, { title: 'Peso atual (kg)', type: 'decimal', width: 110 }, { title: 'Meta (kg)', type: 'decimal', width: 90 },
    { title: 'Falta para a meta (kg)', type: 'decimal', width: 130 }, { title: 'Última medição', type: 'date', width: 120 },
    { title: 'Próxima consulta', type: 'text', width: 220 }, { title: 'Plano alimentar', type: 'text', width: 220 },
    ...(withLastSeen ? [{ title: 'Último acesso ao app', type: 'date' as const, width: 140 }] : []),
    { title: 'Paciente desde', type: 'date', width: 120 },
  ];
  return {
    title: `Pacientes — NutriAli — ${brDate(today)}`,
    tab: 'Pacientes',
    columns,
    rows: rows.map((row) => [
      row.name, row.email || '', row.objective,
      row.initialWeight, row.weight, row.targetWeight,
      row.weight !== null && row.targetWeight !== null ? round1(Math.abs(row.weight - row.targetWeight)) : null,
      row.lastMeasurement, row.nextAppointment || 'Não agendada', planLabel(row),
      ...(withLastSeen ? [row.lastSeen === 'never' ? 'Nunca entrou' : row.lastSeen] : []), row.since,
    ]),
  };
}

// ───────────── Evolução do peso ─────────────

const sourceLabel = (source: string) => (source === 'patient' ? 'Paciente' : source === 'nutritionist' ? 'Nutricionista' : 'Prontuário');

export function weightSheet(patientName: string, entries: WeightEntry[], targetWeight: number | null, today: string): SheetSpec {
  const first = entries[0];
  return {
    title: `Peso de ${patientName} — NutriAli — ${brDate(today)}`,
    tab: 'Evolução do peso',
    columns: [
      { title: 'Data', type: 'date', width: 110 }, { title: 'Peso (kg)', type: 'decimal', width: 90 }, { title: 'Gordura (%)', type: 'decimal', width: 100 },
      { title: 'Mudança desde a anterior (kg)', type: 'decimal', width: 170 }, { title: 'Mudança desde o início (kg)', type: 'decimal', width: 170 },
      { title: 'Falta para a meta (kg)', type: 'decimal', width: 140 }, { title: 'Registrado por', type: 'text', width: 120 },
    ],
    rows: entries.map((entry, i) => [
      entry.date, entry.weight, entry.bodyFat,
      i ? round1(entry.weight - entries[i - 1].weight) : null,
      i ? round1(entry.weight - first.weight) : null,
      targetWeight === null ? null : round1(Math.abs(entry.weight - targetWeight)),
      sourceLabel(entry.source),
    ]),
    chart: { title: `Peso de ${patientName}`, x: 0, y: 1 },
  };
}

// ───────────── Plano alimentar ─────────────

export interface SheetPlanMeal { name: string; time: string; items: string[]; foods?: unknown[] }
export interface SheetPlanDay { name: string; meals: SheetPlanMeal[] }

/** Dias de um plano gravado, limpos para a planilha (planos antigos podem ter os itens num texto só). */
export function sheetPlanDaysOf(plan: unknown): SheetPlanDay[] {
  const days = plan && typeof plan === 'object' && Array.isArray((plan as { days?: unknown }).days) ? (plan as { days: unknown[] }).days : [];
  const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  return days.filter((day): day is Record<string, unknown> => !!day && typeof day === 'object').map((day) => ({
    name: text(day.name, 80) || 'Dia',
    meals: (Array.isArray(day.meals) ? day.meals : []).filter((meal): meal is Record<string, unknown> => !!meal && typeof meal === 'object').map((meal) => {
      const foods = Array.isArray(meal.foods) ? meal.foods : [];
      const raw = Array.isArray(meal.items) ? meal.items : typeof meal.items === 'string' ? [meal.items] : [];
      const kept = raw.map((item, i) => ({ item: text(item, 300), food: foods[i] ?? null })).filter((entry) => entry.item);
      return {
        name: text(meal.name, 80) || 'Refeição', time: text(meal.time, 10), items: kept.map((entry) => entry.item),
        ...(foods.length ? { foods: kept.map((entry) => entry.food) } : {}),
      };
    }),
  }));
}

const totalsCells = (totals: PlanTotals | null): SheetValue[] => (totals ? [totals.kcal, totals.protein, totals.carbs, totals.fat] : [null, null, null, null]);

/** Plano item a item, com o alimento da TACO, os gramas e as contas, e o total de cada refeição e de cada dia. */
export function planSheet(patientName: string, days: SheetPlanDay[], draft: boolean, today: string): SheetSpec {
  const rows: SheetValue[][] = [];
  const boldRows: number[] = [];
  for (const day of days) {
    for (const meal of day.meals) {
      const nutrition = planItemsNutrition(meal);
      meal.items.forEach((item, i) => {
        const n = nutrition[i];
        rows.push([day.name, meal.name, meal.time, item, n ? n.name : '', n ? n.grams : null, n ? n.kcal : null, n ? n.protein : null, n ? n.carbs : null, n ? n.fat : null]);
      });
      const totals = mealTotals(meal);
      if (totals) { boldRows.push(rows.length); rows.push([day.name, meal.name, '', `Total da refeição${totals.incomplete ? ' (incompleto)' : ''}`, '', null, ...totalsCells(totals)]); }
    }
    const totals = dayTotals(day);
    if (totals) { boldRows.push(rows.length); rows.push([day.name, '', '', `Total do dia${totals.incomplete ? ' (incompleto)' : ''}`, '', null, ...totalsCells(totals)]); }
  }
  return {
    title: `Plano alimentar de ${patientName}${draft ? ' (rascunho)' : ''} — NutriAli — ${brDate(today)}`,
    tab: draft ? 'Rascunho do plano' : 'Plano alimentar',
    columns: [
      { title: 'Dia', type: 'text', width: 150 }, { title: 'Refeição', type: 'text', width: 140 }, { title: 'Horário', type: 'text', width: 70 },
      { title: 'Item do plano', type: 'text', width: 260 }, { title: 'Alimento na TACO', type: 'text', width: 240 }, { title: 'Gramas', type: 'number', width: 70 },
      { title: 'Calorias (kcal)', type: 'number', width: 100 }, { title: 'Proteína (g)', type: 'decimal', width: 90 },
      { title: 'Carboidrato (g)', type: 'decimal', width: 100 }, { title: 'Gordura (g)', type: 'decimal', width: 90 },
    ],
    rows,
    boldRows,
  };
}

// ───────────── Agenda ─────────────

export interface AgendaEntry { date: string; weekday: string; start: string; end: string; title: string; where: string }

export function agendaSheet(entries: AgendaEntry[], from: string, to: string): SheetSpec {
  return {
    title: `Agenda de ${brDate(from)} a ${brDate(to)} — NutriAli`,
    tab: 'Agenda',
    columns: [
      { title: 'Data', type: 'date', width: 110 }, { title: 'Dia da semana', type: 'text', width: 120 }, { title: 'Início', type: 'text', width: 80 },
      { title: 'Fim', type: 'text', width: 80 }, { title: 'Compromisso', type: 'text', width: 280 }, { title: 'Local ou link', type: 'text', width: 260 },
    ],
    rows: entries.map((entry) => [entry.date, entry.weekday, entry.start, entry.end, entry.title, entry.where]),
  };
}
