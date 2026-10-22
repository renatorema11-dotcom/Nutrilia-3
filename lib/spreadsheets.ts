// Planilhas que a Ali cria no Google Planilhas da nutricionista. Somente no servidor. As colunas e linhas de cada
// planilha ficam em lib/sheet-specs.ts (as mesmas do Excel baixado pelas telas). A permissão usada (drive.file) só deixa
// o NutriAli mexer nas planilhas que ele mesmo cria: o resto do Drive dela fica de fora. Os valores entram como texto
// ou número, nunca como fórmula, então nada que veio de um cadastro vira comando dentro da planilha.
import { googleRequest } from './google-workspace';
import { MAX_SHEET_ROWS, sheetDateSerial } from './sheet-specs';
import type { ColumnType, SheetSpec, SheetValue } from './sheet-specs';

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

/** Link que baixa a planilha do Google como arquivo do Excel (abre na conta Google de quem é a planilha). */
export const xlsxExportUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/export?format=xlsx`;
