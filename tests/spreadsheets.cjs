// Testa as planilhas que a Ali da nutricionista cria no Google Planilhas (lib/spreadsheets.ts e a ação
// create_spreadsheet), com Firestore, Agenda, Gmail e Planilhas simulados. Nenhum serviço externo é chamado.
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createFirestore, createGoogle, loadLib } = require('./fakes.cjs');

const { store, db, FieldValue } = createFirestore();
const google = createGoogle();
const reports = [];
const context = loadLib(['ali-settings.ts', 'agenda.ts', 'google-workspace.ts', 'appointments.ts', 'weekly-report.ts', 'daily-log.ts', 'consultation-notes.ts',
  'taco-foods.ts', 'food-table.ts', 'plan-nutrition.ts', 'sheet-specs.ts', 'spreadsheets.ts', 'nutritionist-assistant.ts'],
{ FieldValue, fetch: google.fetch, reportServerError: (message) => reports.push(message) });
context.db = db;
const run = (code) => vm.runInContext(code, context);
const plain = (value) => JSON.parse(JSON.stringify(value));

const NUTRI = 'nutri-1';
// Uma terça-feira às 10:00 (Brasília).
context.now = new Date('2026-10-13T13:00:00Z');
// Último acesso: Ana entrou ontem, João nunca entrou; Bia não tem login (sem a informação).
context.lastSeen = async () => new Map([['p-ana', new Date('2026-10-12T15:00:00Z')], ['p-joao', null]]);
const sheet = (input) => { context.input = input; return run(`createSpreadsheet(db, '${NUTRI}', input, lastSeen, now)`).then(plain); };
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const connect = (scopes) => {
  store.set(`googleConnections/${NUTRI}`, { status: 'connected', email: 'carla@exemplo.com', scopes, refreshToken: run("encrypt(getGoogleConfig(), 'autorizacao-de-teste')") });
  run('accessCache.clear()');
};
/** Valores de uma linha da planilha criada (texto, número ou vazio), para comparar fácil. */
const values = (created, row) => created.body.sheets[0].data[0].rowData[row].values.map((c) => (c.userEnteredValue ? Object.values(c.userEnteredValue)[0] : null));

let count = 0;
async function check(name, fn) { await fn(); count++; }

(async () => {
  store.set(`users/${NUTRI}`, { role: 'nutritionist', displayName: 'Dra. Carla Mendes' });
  store.set(`nutritionistSettings/${NUTRI}`, { ali: { displayName: 'Dra. Carla Mendes' } });
  store.set('patients/p-ana', {
    name: 'Ana Souza', email: 'ana@exemplo.com', nutritionistId: NUTRI, objective: 'Emagrecimento', weight: 80, targetWeight: 65, initialWeight: 82,
    createdAt: '2026-09-01T12:00:00.000Z', nextAppointment: 'quarta, 21 de outubro às 14:00',
    measurements: [
      { date: '2026-10-10', weight: 72.4, bodyFat: 30.5, source: 'nutritionist' },
      { date: '2026-09-01', weight: 74, source: 'patient' },
      { date: '2026-09-20', weight: 73.1 },
      { date: 'ontem', weight: 70 },
    ],
    currentPlan: { status: 'approved', days: [{ name: 'Segunda a sexta', meals: [
      { time: '12:00', name: 'Almoço', items: ['Arroz branco', 'Feijão', 'Salada à vontade'], foods: [{ taco: 3, grams: 120 }, { taco: 561, grams: 100 }, null] },
      { time: '16:00', name: 'Lanche', items: ['=HYPERLINK("http://x")'] },
    ] }] },
    pendingPlan: { status: 'draft', source: 'ali', days: [{ name: 'Todos os dias', meals: [{ time: '08:00', name: 'Café', items: ['Ovo cozido'], foods: [{ taco: 488, grams: 50 }] }] }] },
  });
  store.set('patients/p-joao', { name: 'João Pereira', nutritionistId: NUTRI, objective: 'Saúde', createdAt: 'data ruim' });
  store.set('patients/p-bia', { name: 'Bia Lima', nutritionistId: NUTRI, currentPlan: { status: 'draft', days: [{ name: 'Dia', meals: [{ time: '07:00', name: 'Café', items: ['Pão'] }] }] } });
  store.set('patients/p-outro', { name: 'Marcos de Outra Nutri', nutritionistId: 'nutri-2', weight: 90 });

  await check('datas viram data de verdade na planilha (dias desde 30/12/1899); data impossível fica de fora', async () => {
    assert.equal(run("sheetDateSerial('2026-10-19')"), 46314);
    assert.equal(run("sheetDateSerial('1899-12-31')"), 1);
    assert.equal(run("sheetDateSerial('2026-02-31')"), null);
    assert.equal(run("sheetDateSerial('ontem')"), null);
    assert.equal(run("brDate('2026-10-19')"), '19/10/2026');
  });

  await check('o corpo da planilha: cabeçalho em negrito e fixo, número e data com formato, texto nunca vira fórmula', async () => {
    context.spec = { title: 'Teste', tab: 'Aba', columns: [{ title: 'Data', type: 'date' }, { title: 'Peso', type: 'decimal' }, { title: 'Nome', type: 'text' }],
      rows: [['2026-10-13', 72.4, '=IMPORTXML("http://x")'], ['sem data', null, 42]], boldRows: [1] };
    const body = plain(run("spreadsheetBody(spec, 'America/Sao_Paulo')"));
    assert.deepEqual(body.properties, { title: 'Teste', locale: 'pt_BR', timeZone: 'America/Sao_Paulo' });
    assert.equal(body.sheets[0].properties.gridProperties.frozenRowCount, 1);
    const [header, first, second] = body.sheets[0].data[0].rowData;
    assert.equal(header.values[0].userEnteredFormat.textFormat.bold, true);
    assert.deepEqual(first.values[0], { userEnteredValue: { numberValue: 46308 }, userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'dd/mm/yyyy' } } });
    assert.deepEqual(first.values[1].userEnteredFormat.numberFormat, { type: 'NUMBER', pattern: '0.0' });
    assert.deepEqual(first.values[2].userEnteredValue, { stringValue: '=IMPORTXML("http://x")' });
    // Data que não é data fica como texto; número em coluna de texto também; vazio continua vazio (com o negrito do total).
    assert.deepEqual(second.values.map((c) => c.userEnteredValue || null), [{ stringValue: 'sem data' }, null, { stringValue: '42' }]);
    assert.equal(second.values[1].userEnteredFormat.textFormat.bold, true);
  });

  await check('sem a permissão das planilhas (conexão antiga), a Ali pede para conectar de novo e nada é criado', async () => {
    connect(['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.freebusy', 'https://www.googleapis.com/auth/gmail.send']);
    const out = await sheet({ sheet: 'patients' });
    assert.equal(out.status, 409);
    assert.match(out.speech, /entre em Minha Ali e clique em Conectar Google de novo, deixando marcada a permissão das planilhas/);
    assert.equal(google.sheets.length, 0);
    store.delete(`googleConnections/${NUTRI}`);
    run('accessCache.clear()');
    assert.match((await sheet({ sheet: 'patients' })).speech, /não está conectada/);
    connect(['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/gmail.send', SHEETS_SCOPE]);
    for (const kind of ['planilha de bolo', 'constructor', '__proto__', 42, null]) assert.equal((await sheet({ sheet: kind })).status, 422, String(kind));
    assert.equal(google.sheets.length, 0);
  });

  await check('lista de pacientes: só os dela, em ordem, com peso, meta, último acesso e situação do plano; o link vai para o e-mail dela', async () => {
    const out = await sheet({ sheet: 'pacientes' });
    assert.equal(out.ok, true);
    assert.equal(out.speech, 'Pronto! Criei no seu Google Planilhas a lista dos seus 3 pacientes, com peso, meta, próxima consulta e situação do plano. Mandei o link para o seu e-mail, com a opção de baixar em Excel.');
    assert.deepEqual(out.spreadsheet, { title: 'Pacientes — NutriAli — 13/10/2026', url: 'https://docs.google.com/spreadsheets/d/planilha-1/edit', rows: 3, kind: 'patients' });
    const created = google.sheets[0];
    assert.equal(created.body.sheets[0].properties.title, 'Pacientes');
    assert.equal(created.body.properties.timeZone, 'America/Sao_Paulo');
    assert.deepEqual(created.requests, []);
    assert.equal(values(created, 0)[0], 'Nome');
    // Ana: peso atual = última medição (72,4), inicial = o do cadastro (82), falta 7,4 para 65; Bia sem login; João nunca entrou.
    assert.deepEqual(values(created, 1), ['Ana Souza', 'ana@exemplo.com', 'Emagrecimento', 82, 72.4, 65, 7.4, 46305, 'quarta, 21 de outubro às 14:00', 'Aprovado (rascunho novo esperando)', 46307, 46266]);
    assert.deepEqual(values(created, 2), ['Bia Lima', null, null, null, null, null, null, null, 'Não agendada', 'Rascunho esperando aprovação', null, null]);
    assert.deepEqual(values(created, 3), ['João Pereira', null, 'Saúde', null, null, null, null, null, 'Não agendada', 'Sem plano', 'Nunca entrou', null]);
    const mail = google.sent.at(-1);
    assert.deepEqual([mail.to, mail.subject], ['carla@exemplo.com', 'Planilha pronta: Pacientes — NutriAli — 13/10/2026']);
    assert.ok(mail.html.includes('https://docs.google.com/spreadsheets/d/planilha-1/edit'));
    assert.ok(mail.html.includes('https://docs.google.com/spreadsheets/d/planilha-1/export?format=xlsx') && mail.html.includes('Baixar em Excel'));
    assert.deepEqual([store.get(`aliUsage/${NUTRI}`).sheetsDay, store.get(`aliUsage/${NUTRI}`).sheets], ['2026-10-13', 1]);
  });

  await check('evolução do peso: medições em ordem, mudanças, quanto falta para a meta, quem registrou e o gráfico', async () => {
    const out = await sheet({ sheet: 'weights', patientName: 'ana' });
    assert.equal(out.speech, 'Pronto! Criei no seu Google Planilhas a evolução do peso de Ana Souza, com 3 medições e um gráfico. Mandei o link para o seu e-mail, com a opção de baixar em Excel.');
    const created = google.sheets.at(-1);
    assert.equal(created.body.properties.title, 'Peso de Ana Souza — NutriAli — 13/10/2026');
    assert.deepEqual(values(created, 1), [46266, 74, null, null, null, 9, 'Paciente']);
    assert.deepEqual(values(created, 2), [46285, 73.1, null, -0.9, -0.9, 8.1, 'Prontuário']);
    assert.deepEqual(values(created, 3), [46305, 72.4, 30.5, -0.7, -1.6, 7.4, 'Nutricionista']);
    const chart = created.requests[0].addChart.chart;
    assert.equal(chart.spec.basicChart.chartType, 'LINE');
    assert.deepEqual(chart.spec.basicChart.series[0].series.sourceRange.sources[0], { sheetId: 0, startRowIndex: 0, endRowIndex: 4, startColumnIndex: 1, endColumnIndex: 2 });
    // Sem o gráfico (o Google recusou), a planilha fica e a fala não promete gráfico.
    google.chartStatus = 500;
    assert.equal((await sheet({ sheet: 'peso', patientName: 'Ana Souza' })).speech, 'Pronto! Criei no seu Google Planilhas a evolução do peso de Ana Souza, com 3 medições. Mandei o link para o seu e-mail, com a opção de baixar em Excel.');
    google.chartStatus = 200;
    const none = await sheet({ sheet: 'weights', patientName: 'João' });
    assert.deepEqual([none.status, none.speech], [409, 'João Pereira ainda não tem medições de peso registradas.']);
    assert.equal((await sheet({ sheet: 'weights', patientName: 'Marcos' })).status, 404);
    assert.equal((await sheet({ sheet: 'weights' })).status, 422);
  });

  await check('plano alimentar: o aprovado, item a item, com a TACO, total da refeição e do dia; o rascunho só quando ela pede', async () => {
    const before = google.sheets.length;
    const out = await sheet({ sheet: 'plan', patientName: 'Ana Souza' });
    assert.equal(out.speech, 'Pronto! Criei no seu Google Planilhas o plano alimentar aprovado de Ana Souza, com as calorias e os macros pela tabela TACO. O rascunho novo, que ainda espera a sua aprovação, ficou de fora. Mandei o link para o seu e-mail, com a opção de baixar em Excel.');
    const created = google.sheets.at(-1);
    assert.equal(created.body.properties.title, 'Plano alimentar de Ana Souza — NutriAli — 13/10/2026');
    context.meal = { items: ['Arroz branco', 'Feijão', 'Salada à vontade'], foods: [{ taco: 3, grams: 120 }, { taco: 561, grams: 100 }, null] };
    const rice = plain(run('planItemsNutrition(meal)'))[0];
    const totals = plain(run('mealTotals(meal)'));
    assert.deepEqual(values(created, 1), ['Segunda a sexta', 'Almoço', '12:00', 'Arroz branco', 'Arroz, tipo 1, cozido', 120, rice.kcal, rice.protein, rice.carbs, rice.fat]);
    assert.deepEqual(values(created, 3), ['Segunda a sexta', 'Almoço', '12:00', 'Salada à vontade', null, null, null, null, null, null]);
    assert.deepEqual(values(created, 4), ['Segunda a sexta', 'Almoço', null, 'Total da refeição (incompleto)', null, null, totals.kcal, totals.protein, totals.carbs, totals.fat]);
    // Item que parece fórmula entra como texto puro.
    assert.deepEqual(created.body.sheets[0].data[0].rowData[5].values[3].userEnteredValue, { stringValue: '=HYPERLINK("http://x")' });
    assert.match(values(created, 6)[3], /^Total do dia/);
    const bold = created.body.sheets[0].data[0].rowData[4].values[3].userEnteredFormat.textFormat.bold;
    assert.equal(bold, true);
    // O rascunho, quando ela pede.
    const draft = await sheet({ sheet: 'plan', patientName: 'Ana Souza', draft: true });
    assert.match(draft.speech, /^Pronto! Criei no seu Google Planilhas o rascunho do plano de Ana Souza, com as calorias/);
    assert.equal(google.sheets.at(-1).body.properties.title, 'Plano alimentar de Ana Souza (rascunho) — NutriAli — 13/10/2026');
    assert.equal(google.sheets.at(-1).body.sheets[0].properties.title, 'Rascunho do plano');
    // Quem só tem rascunho recebe o rascunho; quem não tem plano, uma explicação.
    assert.match((await sheet({ sheet: 'plan', patientName: 'Bia' })).speech, /o rascunho do plano de Bia Lima\. Mandei/);
    assert.deepEqual(plain(await sheet({ sheet: 'plan', patientName: 'João' })), { ok: false, status: 409, speech: 'João Pereira ainda não tem plano alimentar com refeições.' });
    assert.equal((await sheet({ sheet: 'plan', patientName: 'João', draft: 'true' })).speech, 'João Pereira não tem rascunho de plano esperando aprovação.');
    assert.equal(google.sheets.length, before + 3);
  });

  await check('agenda: compromissos do período com dia, horário e local; período vazio não cria planilha', async () => {
    google.events.set('ev-1', { status: 'confirmed', summary: 'Consulta nutricional — Ana Souza', start: { dateTime: '2026-10-14T14:00:00-03:00' }, end: { dateTime: '2026-10-14T14:50:00-03:00' }, location: 'Rua das Flores, 100' });
    google.events.set('ev-2', { status: 'confirmed', summary: 'Congresso', start: { date: '2026-10-16' }, end: { date: '2026-10-17' } });
    google.events.set('ev-3', { status: 'cancelled', summary: 'Cancelado', start: { dateTime: '2026-10-15T10:00:00-03:00' } });
    google.events.set('ev-4', { status: 'confirmed', summary: 'Longe demais', start: { dateTime: '2026-11-30T10:00:00-03:00' } });
    const out = await sheet({ sheet: 'agenda' });
    assert.equal(out.speech, 'Pronto! Criei no seu Google Planilhas a sua agenda de 13 de outubro a 19 de outubro, com 2 compromissos. Mandei o link para o seu e-mail, com a opção de baixar em Excel.');
    const created = google.sheets.at(-1);
    assert.equal(created.body.properties.title, 'Agenda de 13/10/2026 a 19/10/2026 — NutriAli');
    assert.deepEqual(values(created, 1), [46309, 'quarta-feira', '14:00', '14:50', 'Consulta nutricional — Ana Souza', 'Rua das Flores, 100']);
    assert.deepEqual(values(created, 2), [46311, 'sexta-feira', 'Dia todo', null, 'Congresso', null]);
    // Um mês inteiro a partir de uma data; dias fora da faixa voltam para uma semana.
    assert.match((await sheet({ sheet: 'agenda', date: '2026-11-01', days: 31 })).speech, /de 1 de novembro a 1 de dezembro, com 1 compromisso\./);
    const before = google.sheets.length;
    const empty = plain(await sheet({ sheet: 'agenda', date: '2026-12-01', days: '400' }));
    assert.deepEqual(empty, { ok: true, speech: 'Você não tem compromissos de 1 de dezembro a 7 de dezembro, então não criei a planilha.' });
    assert.equal(google.sheets.length, before);
    assert.equal((await sheet({ sheet: 'agenda', date: 'amanhã' })).status, 422);
  });

  await check('o Google recusou: nada conta no limite, a Ali explica e o aviso de erro sai', async () => {
    const used = store.get(`aliUsage/${NUTRI}`).sheets;
    google.sheetsStatus = 403;
    const out = await sheet({ sheet: 'patients' });
    assert.equal(out.status, 502);
    assert.match(out.speech, /^O Google não deixou criar a planilha agora\. Para eu criar planilhas, entre em Minha Ali/);
    assert.match(reports.at(-1), /o Google não criou a planilha \(código 403\)/);
    google.sheetsStatus = 500;
    assert.equal((await sheet({ sheet: 'patients' })).speech, 'Não consegui criar a planilha no seu Google agora. Nada foi criado. Tente de novo em instantes.');
    google.sheetsStatus = 200;
    assert.equal(store.get(`aliUsage/${NUTRI}`).sheets, used);
  });

  await check('limite de 20 planilhas por dia; o contador de e-mails não apaga o das planilhas', async () => {
    store.set(`aliUsage/${NUTRI}`, { day: '2026-10-13', emails: 3, sheetsDay: '2026-10-13', sheets: 20 });
    const out = await sheet({ sheet: 'patients' });
    assert.deepEqual([out.status, out.speech], [429, 'Você chegou ao limite de 20 planilhas por dia pela Ali. Amanhã libera de novo.']);
    store.set(`aliUsage/${NUTRI}`, { sheetsDay: '2026-10-12', sheets: 20 });
    assert.equal((await sheet({ sheet: 'patients' })).ok, true);
    context.mail = { to: 'Ana Souza', subject: 'Oi', body: 'Tudo bem?' };
    assert.equal((await run(`sendEmail(db, '${NUTRI}', mail, now)`)).ok, true);
    const usage = store.get(`aliUsage/${NUTRI}`);
    assert.deepEqual([usage.day, usage.emails, usage.sheetsDay, usage.sheets], ['2026-10-13', 1, '2026-10-13', 1]);
  });

  await check('a conexão guarda só as permissões conhecidas e diz se as planilhas estão liberadas', async () => {
    context.data = { scopes: ['openid', SHEETS_SCOPE, 'https://www.googleapis.com/auth/drive', 42] };
    assert.deepEqual(plain(run('grantedScopes(data.scopes)')), ['openid', SHEETS_SCOPE]);
    assert.equal(plain(await run(`connectionStatus(db, '${NUTRI}')`)).sheets, true);
    connect(['https://www.googleapis.com/auth/calendar.events']);
    assert.equal(plain(await run(`connectionStatus(db, '${NUTRI}')`)).sheets, false);
  });

  await check('ao conectar o Google, a permissão das planilhas é opcional: sem ela a conexão vale, mas sem planilhas', async () => {
    const original = context.fetch;
    const revoked = [];
    let granted = '';
    const idToken = `x.${Buffer.from(JSON.stringify({ email: 'nova@exemplo.com' })).toString('base64url')}.y`;
    context.fetch = async (url) => {
      if (url.startsWith('https://oauth2.googleapis.com/revoke')) { revoked.push(url); return { ok: true, status: 200, json: async () => ({}) }; }
      return { ok: true, status: 200, json: async () => ({ access_token: 'acesso', refresh_token: 'renovacao', id_token: idToken, scope: granted }) };
    };
    const base = 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/gmail.send';
    granted = `${base} ${SHEETS_SCOPE}`;
    assert.deepEqual(plain(await run(`completeConnection(db, getGoogleConfig(), 'nutri-9', 'codigo')`)), { ok: true, email: 'nova@exemplo.com', sheets: true });
    assert.deepEqual(store.get('googleConnections/nutri-9').scopes, ['openid', 'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.freebusy', 'https://www.googleapis.com/auth/gmail.send', SHEETS_SCOPE]);
    granted = base;
    assert.deepEqual(plain(await run(`completeConnection(db, getGoogleConfig(), 'nutri-9', 'codigo')`)), { ok: true, email: 'nova@exemplo.com', sheets: false });
    assert.equal(plain(await run(`connectionStatus(db, 'nutri-9')`)).sheets, false);
    // Sem a agenda ou o Gmail, a conexão é recusada (e a autorização devolvida), como antes.
    granted = `openid https://www.googleapis.com/auth/calendar.events ${SHEETS_SCOPE}`;
    assert.deepEqual(plain(await run(`completeConnection(db, getGoogleConfig(), 'nutri-8', 'codigo')`)), { ok: false, reason: 'scopes' });
    assert.equal(revoked.length, 1);
    assert.ok(run("buildAuthUrl(getGoogleConfig(), 'estado')").includes(encodeURIComponent(SHEETS_SCOPE)));
    context.fetch = original;
  });

  console.log(`${count} verificações das planilhas da Ali passaram. Nenhum serviço externo foi chamado.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
