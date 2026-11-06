// Testa o arquivo do Excel que o app monta sozinho (lib/xlsx.ts) e as planilhas das telas (lib/sheet-specs.ts):
// abre o zip, confere a soma de cada arquivo e o XML de dentro. Nada externo é chamado.
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
const { loadLib } = require('./fakes.cjs');

const context = loadLib(['taco-foods.ts', 'food-table.ts', 'plan-nutrition.ts', 'sheet-specs.ts', 'xlsx.ts'], { TextEncoder, Uint8Array, Uint32Array, DataView, Intl });
const run = (code) => require('node:vm').runInContext(code, context);

/** Lê um zip sem compressão: devolve { nome: texto }, conferindo assinaturas, tamanhos e o CRC-32 de cada arquivo. */
function unzip(bytes) {
  const buf = Buffer.from(bytes);
  const end = buf.length - 22;
  assert.equal(buf.readUInt32LE(end), 0x06054b50, 'fim do índice');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  assert.equal(at + buf.readUInt32LE(end + 12), end, 'tamanho do índice');
  const files = {};
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(at), 0x02014b50, 'entrada do índice');
    const size = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLength);
    const local = buf.readUInt32LE(at + 42);
    assert.equal(buf.readUInt32LE(local), 0x04034b50, 'cabeçalho local');
    assert.equal(buf.readUInt16LE(local + 8), 0, 'sem compressão');
    const data = buf.subarray(local + 30 + buf.readUInt16LE(local + 26), local + 30 + buf.readUInt16LE(local + 26) + size);
    assert.equal(zlib.crc32(data), buf.readUInt32LE(at + 16), `CRC de ${name}`);
    files[name] = data.toString('utf8');
    at += 46 + nameLength;
  }
  return files;
}

let count = 0;
function check(name, fn) { fn(); count++; }

check('CRC-32 igual ao do zlib e zip que se abre de novo, com os 6 arquivos do Excel', () => {
  context.bytes = new TextEncoder().encode('NutriAli — planilha ✓');
  assert.equal(run('crc32(bytes)'), zlib.crc32(Buffer.from(context.bytes)));
  context.spec = { title: 'Teste', tab: 'Aba', columns: [{ title: 'Nome', type: 'text' }], rows: [['Ana']] };
  const files = unzip(run('buildXlsx(spec)'));
  assert.deepEqual(Object.keys(files).sort(), ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']);
  assert.match(files['xl/workbook.xml'], /<sheet name="Aba" sheetId="1" r:id="rId1"\/>/);
});

check('células: número, decimal e data com formato; texto puro mesmo quando parece fórmula; negrito nos totais', () => {
  context.spec = {
    title: 'Teste', tab: 'Pacientes',
    columns: [{ title: 'Data', type: 'date' }, { title: 'Peso (kg)', type: 'decimal' }, { title: 'Gramas', type: 'number' }, { title: 'Nome', type: 'text' }],
    rows: [['2026-10-19', 72.4, 120, '=HYPERLINK("http://x")'], ['sem data', null, 'cem', 'Ana & <João> "Zé"'], ['', 10, 20, 'Total']],
    boldRows: [2],
  };
  const sheet = unzip(run('buildXlsx(spec)'))['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /<dimension ref="A1:D4"\/>/);
  assert.match(sheet, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
  assert.match(sheet, /<row r="1"><c r="A1" s="1" t="inlineStr"><is><t>Data<\/t><\/is><\/c>/);
  assert.match(sheet, /<c r="A2" s="4"><v>46314<\/v><\/c><c r="B2" s="3"><v>72.4<\/v><\/c><c r="C2" s="2"><v>120<\/v><\/c>/);
  assert.match(sheet, /<c r="D2" t="inlineStr"><is><t>=HYPERLINK\(&quot;http:\/\/x&quot;\)<\/t><\/is><\/c>/);
  assert.ok(!sheet.includes('<f>'));
  assert.match(sheet, /<row r="3"><c r="A3" t="inlineStr"><is><t>sem data<\/t><\/is><\/c><c r="C3" t="inlineStr"><is><t>cem<\/t><\/is><\/c><c r="D3" t="inlineStr"><is><t>Ana &amp; &lt;João&gt; &quot;Zé&quot;<\/t><\/is><\/c><\/row>/);
  assert.match(sheet, /<row r="4"><c r="A4" s="5"\/><c r="B4" s="7"><v>10<\/v><\/c><c r="C4" s="6"><v>20<\/v><\/c><c r="D4" s="5" t="inlineStr"><is><t>Total<\/t><\/is><\/c><\/row>/);
});

check('texto com caracteres que o XML não aceita, emoji quebrado, espaços nas pontas; nome da aba e colunas além do Z', () => {
  context.raw = ` Oi\u0001 tudo\u0008 bem? 😀 \uD83D fim `;
  assert.equal(run('xmlText(raw)'), ' Oi tudo bem? 😀  fim ');
  context.spec = { title: 'T', tab: 'Peso: [Ana]/Souza*? muito longo demais para o Excel', columns: [{ title: 'Nota', type: 'text' }], rows: [[context.raw]] };
  const files = unzip(run('buildXlsx(spec)'));
  assert.match(files['xl/worksheets/sheet1.xml'], /<t xml:space="preserve"> Oi tudo bem\? 😀  fim <\/t>/);
  assert.match(files['xl/workbook.xml'], /<sheet name="Peso Ana Souza muito longo dema"/);
  assert.equal(run("sheetTabName(\"'''\")"), 'Planilha');
  assert.deepEqual([0, 25, 26, 27, 51, 52, 701, 702].map((i) => run(`columnName(${i})`)), ['A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
});

check('lista de pacientes da tela: sem a coluna de último acesso, que só o servidor sabe', () => {
  context.patient = { name: ' Ana Souza ', email: 'ana@exemplo.com', objective: 'Emagrecimento', weight: 80, targetWeight: 65, createdAt: '2026-09-01T12:00:00.000Z',
    measurements: [{ date: '2026-10-10', weight: 72.4 }, { date: '2026-09-01', weight: 74, source: 'patient' }], currentPlan: { status: 'approved' } };
  const row = JSON.parse(run("JSON.stringify(patientSheetRowOf(patient, 'America/Sao_Paulo'))"));
  assert.deepEqual(row, { name: 'Ana Souza', email: 'ana@exemplo.com', objective: 'Emagrecimento', initialWeight: 74, weight: 72.4, targetWeight: 65, lastMeasurement: '2026-10-10',
    nextAppointment: '', plan: 'approved', pendingDraft: false, lastSeen: '', since: '2026-09-01' });
  context.rows = [row];
  const spec = JSON.parse(run("JSON.stringify(patientsSheet(rows, '2026-10-19', { withLastSeen: false }))"));
  assert.equal(spec.columns.length, 11);
  assert.ok(!spec.columns.some((c) => c.title === 'Último acesso ao app'));
  assert.deepEqual(spec.rows[0], ['Ana Souza', 'ana@exemplo.com', 'Emagrecimento', 74, 72.4, 65, 7.4, '2026-10-10', 'Não agendada', 'Aprovado', '2026-09-01']);
  assert.equal(run("sheetFileName('Peso de Ana: \"teste\" / 19/10/2026', 'xlsx')"), 'Peso de Ana- -teste- - 19-10-2026.xlsx');
});

check('plano da tela: itens em texto antigo, refeições e dias limpos, e as contas da TACO', () => {
  context.plan = { days: [{ name: ' Segunda ', meals: [
    { name: 'Almoço', time: '12:00', items: ['Arroz branco', ' ', 'Feijão'], foods: [{ taco: 3, grams: 120 }, null, { taco: 561, grams: 100 }] },
    { name: 'Lanche', time: '16:00', items: 'Maçã' },
    null,
  ] }, 'lixo'] };
  const days = JSON.parse(run('JSON.stringify(sheetPlanDaysOf(plan))'));
  assert.deepEqual(days, [{ name: 'Segunda', meals: [
    { name: 'Almoço', time: '12:00', items: ['Arroz branco', 'Feijão'], foods: [{ taco: 3, grams: 120 }, { taco: 561, grams: 100 }] },
    { name: 'Lanche', time: '16:00', items: ['Maçã'] },
  ] }]);
  context.days = days;
  const spec = JSON.parse(run("JSON.stringify(planSheet('Ana', days, false, '2026-10-19'))"));
  assert.deepEqual(spec.rows.map((r) => r[3]), ['Arroz branco', 'Feijão', 'Total da refeição', 'Maçã', 'Total do dia (incompleto)']);
  assert.deepEqual(spec.boldRows, [2, 4]);
  const sheet = unzip(run('buildXlsx(planSheet("Ana", days, false, "2026-10-19"))'))['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /<c r="E2" t="inlineStr"><is><t>Arroz, tipo 1, cozido<\/t><\/is><\/c><c r="F2" s="2"><v>120<\/v><\/c>/);
});

console.log(`${count} verificações do arquivo do Excel passaram. Nada externo foi chamado.`);
