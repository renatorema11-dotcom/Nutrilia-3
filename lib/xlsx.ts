// Arquivo do Excel (.xlsx) de uma planilha da nutricionista, montado no próprio app, sem biblioteca externa: um .xlsx
// é um pacote zip com alguns arquivos XML. Roda no navegador (botões "Baixar em Excel") e nos testes. Os valores entram
// como texto ou número, nunca como fórmula: nada que veio de um cadastro vira comando dentro da planilha.
import { MAX_SHEET_ROWS, sheetDateSerial } from './sheet-specs';
import type { ColumnType, SheetSpec, SheetValue } from './sheet-specs';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ───────────── Zip ─────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32, a soma de conferência que o zip guarda de cada arquivo. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Zip sem compressão ("stored"): simples e aceito pelo Excel, pelo Google Planilhas e pelo LibreOffice. */
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true); // assinatura do arquivo
    l.setUint16(4, 20, true); // versão necessária (2.0)
    l.setUint16(12, 0x21, true); // data: 01/01/1980
    l.setUint32(14, crc, true);
    l.setUint32(18, file.data.length, true);
    l.setUint32(22, file.data.length, true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, file.data);
    const entry = new Uint8Array(46 + name.length);
    const e = new DataView(entry.buffer);
    e.setUint32(0, 0x02014b50, true); // assinatura do índice
    e.setUint16(4, 20, true);
    e.setUint16(6, 20, true);
    e.setUint16(14, 0x21, true);
    e.setUint32(16, crc, true);
    e.setUint32(20, file.data.length, true);
    e.setUint32(24, file.data.length, true);
    e.setUint16(28, name.length, true);
    e.setUint32(42, offset, true);
    entry.set(name, 46);
    central.push(entry);
    offset += local.length + file.data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const d = new DataView(end.buffer);
  d.setUint32(0, 0x06054b50, true); // fim do índice
  d.setUint16(8, files.length, true);
  d.setUint16(10, files.length, true);
  d.setUint32(12, centralSize, true);
  d.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of all) { out.set(part, at); at += part.length; }
  return out;
}

// ───────────── Planilha ─────────────

/** Tira metades soltas de emoji (pares de "surrogates" quebrados), que o XML não aceita. */
function wellFormed(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { out += value[i] + value[i + 1]; i++; }
    } else if (code < 0xdc00 || code > 0xdfff) out += value[i];
  }
  return out;
}

/** Texto seguro para XML: sem caracteres de controle que o XML não aceita e com &, <, > e aspas trocados. */
export function xmlText(value: string): string {
  return wellFormed(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Coluna 0 → "A", 26 → "AA". */
export function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** O Excel não aceita alguns caracteres no nome da aba, nem mais de 31 letras. */
export const sheetTabName = (tab: string) => tab.replace(/[[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Planilha';

// Estilos (posição em cellXfs): 0 texto, 1 cabeçalho, 2 número inteiro, 3 decimal, 4 data; 5 a 8 iguais em negrito.
const STYLE: Record<ColumnType, number> = { text: 0, number: 2, decimal: 3, date: 4 };
const BOLD: Record<ColumnType, number> = { text: 5, number: 6, decimal: 7, date: 8 };
const xf = (numFmt: number, bold: boolean) => `<xf numFmtId="${numFmt}" fontId="${bold ? 1 : 0}" fillId="0" borderId="0" xfId="0"${numFmt ? ' applyNumberFormat="1"' : ''}${bold ? ' applyFont="1"' : ''}/>`;
const STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="2"><numFmt numFmtId="164" formatCode="0.0"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>'
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFDBEDE3"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="9">'
  + xf(0, false)
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
  + xf(1, false) + xf(164, false) + xf(165, false)
  + xf(0, true) + xf(1, true) + xf(164, true) + xf(165, true)
  + '</cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>';

function inlineText(ref: string, style: number, text: string): string {
  const clean = xmlText(text.slice(0, 2000));
  const keepSpaces = /^\s|\s$|\n/.test(clean) ? ' xml:space="preserve"' : '';
  return `<c r="${ref}"${style ? ` s="${style}"` : ''} t="inlineStr"><is><t${keepSpaces}>${clean}</t></is></c>`;
}

function cellXml(ref: string, value: SheetValue, type: ColumnType, bold: boolean): string {
  const style = bold ? BOLD[type] : STYLE[type];
  if (value === null || value === '') return bold ? `<c r="${ref}" s="${BOLD.text}"/>` : '';
  if (typeof value === 'number' && Number.isFinite(value) && (type === 'number' || type === 'decimal')) return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  if (type === 'date' && typeof value === 'string') {
    const serial = sheetDateSerial(value);
    if (serial !== null) return `<c r="${ref}" s="${style}"><v>${serial}</v></c>`;
  }
  // Texto (também o que não deu para ler como data ou número): sempre texto puro, nunca fórmula.
  return inlineText(ref, bold ? BOLD.text : 0, String(value));
}

/** A aba com o cabeçalho fixo no topo, as larguras das colunas e os formatos de número e data. */
export function worksheetXml(spec: SheetSpec): string {
  const rows = spec.rows.slice(0, MAX_SHEET_ROWS);
  const bold = new Set(spec.boldRows || []);
  const last = `${columnName(Math.max(spec.columns.length - 1, 0))}${rows.length + 1}`;
  const cols = spec.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(8, Math.round(((c.width || 140) - 5) / 7 * 100) / 100)}" customWidth="1"/>`).join('');
  const header = `<row r="1">${spec.columns.map((c, i) => inlineText(`${columnName(i)}1`, 1, c.title)).join('')}</row>`;
  const body = rows.map((row, r) => `<row r="${r + 2}">${spec.columns.map((c, i) => cellXml(`${columnName(i)}${r + 2}`, row[i] ?? null, c.type, bold.has(r))).join('')}</row>`).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<dimension ref="A1:${last}"/>`
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + (cols ? `<cols>${cols}</cols>` : '')
    + `<sheetData>${header}${body}</sheetData>`
    + '</worksheet>';
}

/** O arquivo .xlsx completo de uma planilha (uma aba). */
export function buildXlsx(spec: SheetSpec): Uint8Array {
  const encoder = new TextEncoder();
  const file = (name: string, xml: string) => ({ name, data: encoder.encode(xml) });
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  return zipStore([
    file('[Content_Types].xml', `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '</Types>'),
    file('_rels/.rels', `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>'),
    file('xl/workbook.xml', `${head}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
      + `<bookViews><workbookView/></bookViews><sheets><sheet name="${xmlText(sheetTabName(spec.tab))}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    file('xl/_rels/workbook.xml.rels', `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '</Relationships>'),
    file('xl/styles.xml', STYLES_XML),
    file('xl/worksheets/sheet1.xml', worksheetXml(spec)),
  ]);
}
