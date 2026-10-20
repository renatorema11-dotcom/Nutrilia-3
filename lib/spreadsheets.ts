// Planilhas que a Ali cria no Google Planilhas da nutricionista: lista de pacientes, evolução do peso, plano alimentar
// com as contas da TACO e agenda. Somente no servidor. A permissão usada (drive.file) só deixa o NutriAli mexer nas
// planilhas que ele mesmo cria: o resto do Drive dela fica de fora. Os valores entram como texto ou número, nunca como
// fórmula, então nada que veio de um cadastro vira comando dentro da planilha.
import { googleRequest } from './google-workspace';
import { dayTotals, mealTotals, planItemsNutrition } from './plan-nutrition';
import type { PlanTotals } from './plan-nutrition';

export type ColumnType = 'text' | 'number' | 'decimal' | 'date';
export interface SheetColumn { title: string; type: ColumnType; width?: number }
export type SheetValue = string | number | null;

export interface SheetSpec {
  /** Nome do arquivo no Google Planilhas. */
  title: string;
  /** Nome da aba. */
  tab: string;
  columns: SheetColumn[];
  rows: SheetValue[][];
  /** Linhas em negrito (totais), pelo índice em rows. */
  boldRows?: number[];
  /** Gráfico de linha: coluna do eixo horizontal e coluna dos valores (índices em columns). */
  chart?: { title: string; x: number; y: number };
}

export const MAX_SHEET_ROWS = 2000;

const SHEET_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "2026-10-19" → número de dias usado pelo Google Planilhas para datas (contados de 30/12/1899). */
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

const HEADER_COLOR = { red: 0.86, green: 0.93, blue: 0.89 };
const NUMBER_FORMATS: Record<ColumnType, { type: string; pattern: string } | null> = {
  text: null,
  number: { type: 'NUMBER', pattern: '0' },
  decimal: { type: 'NUMBER', pattern: '0.0' },
  date: { type: 'DATE', pattern: 'dd/mm/yyyy' },
};

/** Uma célula no formato da API do Google Planilhas. */
function cell(value: SheetValue, type: ColumnType, bold: boolean): Record<string, unknown> {
  const format: Record<string, unknown> = bold ? { textFormat: { bold: true } } : {};
  if (value === null || value === '') return Object.keys(format).length ? { userEnteredFormat: format } : {};
  if (typeof value === 'number' && Number.isFinite(value) && (type === 'number' || type === 'decimal')) {
    return { userEnteredValue: { numberValue: value }, userEnteredFormat: { ...format, numberFormat: NUMBER_FORMATS[type] } };
  }
  if (type === 'date' && typeof value === 'string') {
    const serial = sheetDateSerial(value);
    if (serial !== null) return { userEnteredValue: { numberValue: serial }, userEnteredFormat: { ...format, numberFormat: NUMBER_FORMATS.date } };
  }
  // stringValue é sempre texto puro: um "=" no começo não vira fórmula.
  return { userEnteredValue: { stringValue: String(value).slice(0, 2000) }, ...(Object.keys(format).length ? { userEnteredFormat: format } : {}) };
}

/** Corpo do pedido que cria a planilha já preenchida (cabeçalho fixo no topo, larguras e formatos de número e data). */
export function spreadsheetBody(spec: SheetSpec, timeZone: string): Record<string, unknown> {
  const bold = new Set(spec.boldRows || []);
  const header = { values: spec.columns.map((c) => ({ userEnteredValue: { stringValue: c.title }, userEnteredFormat: { textFormat: { bold: true }, backgroundColor: HEADER_COLOR, wrapStrategy: 'WRAP', verticalAlignment: 'MIDDLE' } })) };
  const rows = spec.rows.slice(0, MAX_SHEET_ROWS).map((row, i) => ({ values: spec.columns.map((c, j) => cell(row[j] ?? null, c.type, bold.has(i))) }));
  return {
    properties: { title: spec.title.slice(0, 200), locale: 'pt_BR', timeZone },
    sheets: [{
      properties: { sheetId: 0, title: spec.tab.slice(0, 90), gridProperties: { frozenRowCount: 1, rowCount: Math.max(rows.length + 20, 100), columnCount: Math.max(spec.columns.length + 10, 26) } },
      data: [{ startRow: 0, startColumn: 0, rowData: [header, ...rows], columnMetadata: spec.columns.map((c) => ({ pixelSize: c.width || 140 })) }],
    }],
  };
}

/** Pedido do gráfico de linha (ex.: peso ao longo do tempo), ao lado da tabela. */
export function chartRequest(spec: SheetSpec): Record<string, unknown> | null {
  if (!spec.chart || spec.rows.length < 2) return null;
  const end = Math.min(spec.rows.length, MAX_SHEET_ROWS) + 1;
  const range = (column: number) => ({ sourceRange: { sources: [{ sheetId: 0, startRowIndex: 0, endRowIndex: end, startColumnIndex: column, endColumnIndex: column + 1 }] } });
  return {
    addChart: {
      chart: {
        spec: {
          title: spec.chart.title,
          basicChart: {
            chartType: 'LINE', legendPosition: 'NO_LEGEND', headerCount: 1,
            axis: [{ position: 'BOTTOM_AXIS', title: spec.columns[spec.chart.x].title }, { position: 'LEFT_AXIS', title: spec.columns[spec.chart.y].title }],
            domains: [{ domain: range(spec.chart.x) }],
            series: [{ series: range(spec.chart.y), targetAxis: 'LEFT_AXIS' }],
          },
        },
        position: { overlayPosition: { anchorCell: { sheetId: 0, rowIndex: 1, columnIndex: spec.columns.length + 1 }, widthPixels: 640, heightPixels: 340 } },
      },
    },
  };
}

export const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

export type CreatedSheet = { ok: true; id: string; url: string; chart: boolean } | { ok: false; status: number };

/** Cria a planilha no Google Planilhas da nutricionista. O gráfico é um extra: se falhar, a planilha fica sem ele. */
export async function createSheet(token: string, spec: SheetSpec, timeZone: string): Promise<CreatedSheet> {
  const res = await googleRequest(token, 'POST', `${SHEETS_API}?fields=spreadsheetId,spreadsheetUrl`, spreadsheetBody(spec, timeZone)).catch(() => null);
  if (!res || !res.ok || typeof res.json.spreadsheetId !== 'string') return { ok: false, status: res ? res.status : 0 };
  const id = res.json.spreadsheetId;
  const url = typeof res.json.spreadsheetUrl === 'string' ? res.json.spreadsheetUrl : `https://docs.google.com/spreadsheets/d/${id}/edit`;
  const chart = chartRequest(spec);
  let charted = false;
  if (chart) {
    const added = await googleRequest(token, 'POST', `${SHEETS_API}/${encodeURIComponent(id)}:batchUpdate`, { requests: [chart] }).catch(() => null);
    charted = !!added && added.ok;
  }
  return { ok: true, id, url, chart: charted };
}

// ───────────── As planilhas ─────────────

const round1 = (value: number) => Math.round(value * 10) / 10;

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

const planLabel = (row: { plan: PatientSheetRow['plan']; pendingDraft: boolean }) => (row.plan === 'approved'
  ? (row.pendingDraft ? 'Aprovado (rascunho novo esperando)' : 'Aprovado')
  : row.plan === 'draft' ? 'Rascunho esperando aprovação' : 'Sem plano');

export function patientsSheet(rows: PatientSheetRow[], today: string): SheetSpec {
  return {
    title: `Pacientes — NutriAli — ${brDate(today)}`,
    tab: 'Pacientes',
    columns: [
      { title: 'Nome', type: 'text', width: 200 }, { title: 'E-mail', type: 'text', width: 200 }, { title: 'Objetivo', type: 'text', width: 160 },
      { title: 'Peso inicial (kg)', type: 'decimal', width: 110 }, { title: 'Peso atual (kg)', type: 'decimal', width: 110 }, { title: 'Meta (kg)', type: 'decimal', width: 90 },
      { title: 'Falta para a meta (kg)', type: 'decimal', width: 130 }, { title: 'Última medição', type: 'date', width: 120 },
      { title: 'Próxima consulta', type: 'text', width: 220 }, { title: 'Plano alimentar', type: 'text', width: 220 },
      { title: 'Último acesso ao app', type: 'date', width: 140 }, { title: 'Paciente desde', type: 'date', width: 120 },
    ],
    rows: rows.map((row) => [
      row.name, row.email || '', row.objective,
      row.initialWeight, row.weight, row.targetWeight,
      row.weight !== null && row.targetWeight !== null ? round1(Math.abs(row.weight - row.targetWeight)) : null,
      row.lastMeasurement, row.nextAppointment || 'Não agendada', planLabel(row),
      row.lastSeen === 'never' ? 'Nunca entrou' : row.lastSeen, row.since,
    ]),
  };
}

export interface WeightEntry { date: string; weight: number; bodyFat: number | null; source: string }

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

interface SheetPlanMeal { name: string; time: string; items: string[]; foods?: unknown[] }
interface SheetPlanDay { name: string; meals: SheetPlanMeal[] }

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
