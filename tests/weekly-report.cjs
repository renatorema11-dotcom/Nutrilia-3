// Testa o resumo semanal da nutricionista e o relatório de uso da Ali
// com Firestore e Gmail simulados. Nenhum serviço externo é chamado.
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createFirestore, createGoogle, loadLib } = require('./fakes.cjs');

const { store, db, FieldValue } = createFirestore();
const google = createGoogle();
const context = loadLib(['ali-settings.ts', 'agenda.ts', 'google-workspace.ts', 'weekly-report.ts'], { FieldValue, fetch: google.fetch });
context.db = db;
const run = (code) => vm.runInContext(code, context);

let count = 0;
async function check(name, fn) { await fn(); count++; }

// Segunda-feira, 12 de outubro de 2026, às 07:00 de Brasília.
const NOW = new Date('2026-10-12T10:00:00Z');
context.now = NOW;
const daysAgo = (n) => new Date(NOW.getTime() - n * 86_400_000);
// Último acesso ao app: Ana ontem, João há 12 dias, Bia nunca entrou; Caio não tem login.
context.lastSeen = async (uids) => new Map(uids.flatMap((uid) => (
  uid === 'p-ana' ? [[uid, daysAgo(1)]] : uid === 'p-joao' ? [[uid, daysAgo(12)]] : uid === 'p-bia' ? [[uid, null]] : uid === 'p-x' ? [[uid, daysAgo(0)]] : []
)));

(async () => {
  const connect = (uid, email) => store.set(`googleConnections/${uid}`, { status: 'connected', email, refreshToken: run("encrypt(getGoogleConfig(), 'autorizacao-de-teste')") });
  store.set('users/nutri-1', {
    role: 'nutritionist', displayName: 'Dra. Carla Mendes',
    appointments: [
      { id: '1', patientName: 'Ana Souza', date: '2026-10-13', time: '14:00', status: 'Agendada', mode: 'online' },
      { id: '2', patientName: 'João <b>Pereira</b>', date: '2026-10-12', time: '09:30', status: 'Agendada' },
      { id: '3', patientName: 'Cancelada', date: '2026-10-14', time: '10:00', status: 'Cancelada' },
      { id: '4', patientName: 'Longe', date: '2026-10-25', time: '10:00', status: 'Agendada' },
      { id: '5', patientName: 'Passada', date: '2026-10-09', time: '10:00', status: 'Agendada' },
    ],
  });
  connect('nutri-1', 'carla@exemplo.com');
  store.set('patients/p-ana', { name: 'Ana Souza', nutritionistId: 'nutri-1', currentPlan: { status: 'approved' }, measurements: [{ date: '2026-09-20', weight: 73 }, { date: '2026-10-10', weight: 72.4 }] });
  store.set('patients/p-joao', { name: 'João <b>Pereira</b>', nutritionistId: 'nutri-1', currentPlan: { status: 'draft' }, measurements: [{ date: '2026-09-01', weight: 90 }] });
  store.set('patients/p-bia', { name: 'Bia Lima', nutritionistId: 'nutri-1' });
  store.set('patients/p-caio', { name: 'Caio Reis', nutritionistId: 'nutri-1', currentPlan: { status: 'approved' } });
  store.set('patients/p-outra', { name: 'Paciente de Outra', nutritionistId: 'nutri-2' });
  for (const n of [0, 2, 5]) store.set(`patients/p-ana/foodLogs/log-${n}`, { description: 'refeição', loggedAt: daysAgo(n).toISOString(), source: 'ali' });
  store.set('patients/p-ana/foodLogs/antigo', { description: 'refeição', loggedAt: daysAgo(9).toISOString(), source: 'ali' });
  store.set('patients/p-joao/foodLogs/antigo', { description: 'refeição', loggedAt: daysAgo(20).toISOString(), source: 'ali' });

  await check('a semana começa na segunda, no horário de Brasília', async () => {
    const key = (iso) => { context.at = new Date(iso); return run("mondayKey(at, 'America/Sao_Paulo')"); };
    assert.equal(key('2026-10-12T10:00:00Z'), '2026-10-12');
    assert.equal(key('2026-10-18T23:00:00Z'), '2026-10-12'); // domingo à noite
    assert.equal(key('2026-10-19T02:00:00Z'), '2026-10-12'); // ainda domingo em Brasília
    assert.equal(key('2026-10-19T03:00:00Z'), '2026-10-19');
  });

  await check('junta só os pacientes dela, as refeições e pesos dos últimos 7 dias e as consultas dos próximos 7', async () => {
    const data = JSON.parse(JSON.stringify(await run("collectWeek(db, 'nutri-1', lastSeen, now, 'America/Sao_Paulo')")));
    assert.deepEqual(data.patients.map((patient) => patient.name), ['Ana Souza', 'Bia Lima', 'Caio Reis', 'João <b>Pereira</b>']);
    assert.deepEqual(data.patients[0], { name: 'Ana Souza', meals: 3, weighed: true, weight: 72.4, change: -0.6, awayDays: 1, neverSeen: false, plan: 'approved' });
    assert.deepEqual(data.patients[1], { name: 'Bia Lima', meals: 0, weighed: false, weight: null, change: null, awayDays: null, neverSeen: true, plan: 'none' });
    assert.deepEqual(data.patients[3], { name: 'João <b>Pereira</b>', meals: 0, weighed: false, weight: null, change: null, awayDays: 12, neverSeen: false, plan: 'draft' });
    assert.deepEqual(data.appointments.map((a) => `${a.date} ${a.time} ${a.patientName}`), ['2026-10-12 09:30 João <b>Pereira</b>', '2026-10-13 14:00 Ana Souza']);
    assert.equal(data.seenKnown, true);
  });

  await check('o e-mail sai pelo Gmail dela, para ela mesma, com as quatro partes e sem HTML vindo de nomes', async () => {
    assert.deepEqual({ ...(await run('runWeeklySummaries(db, lastSeen, now)')) }, { checked: 1, sent: 1, skipped: 0, failed: 0 });
    assert.equal(google.sent.length, 1);
    const mail = google.sent[0];
    assert.equal(mail.to, 'carla@exemplo.com');
    assert.match(mail.from, /NutriAli <carla@exemplo\.com>/);
    assert.equal(mail.subject, 'Seu resumo da semana (12 de outubro)');
    assert.match(mail.html, /Olá, Dra\. Carla Mendes! Este é o resumo da sua semana no NutriAli, com 4 pacientes\./);
    assert.match(mail.html, /segunda-feira, 12\/10, às 09:30: <strong>João &lt;b&gt;Pereira&lt;\/b&gt;<\/strong>/);
    assert.match(mail.html, /terça-feira, 13\/10, às 14:00: <strong>Ana Souza<\/strong> \(online\)/);
    assert.match(mail.html, /<strong>Ana Souza<\/strong>: 3 refeições anotadas pela Ali; peso 72,4 kg \(−0,6 kg\)/);
    assert.match(mail.html, /<strong>João &lt;b&gt;Pereira&lt;\/b&gt;<\/strong>: 12 dias sem abrir o app/);
    assert.match(mail.html, /<strong>Bia Lima<\/strong>: ainda não entrou no app/);
    assert.match(mail.html, /Esperando a sua aprovação: João &lt;b&gt;Pereira&lt;\/b&gt;\./);
    assert.match(mail.html, /Ainda sem plano: Bia Lima\./);
    assert.ok(!mail.html.includes('<b>Pereira</b>'));
    assert.ok(!mail.html.includes('Paciente de Outra') && !mail.html.includes('Cancelada') && !mail.html.includes('Longe') && !mail.html.includes('Passada'));
    // Caio não tem login: não dá para dizer que sumiu.
    assert.ok(!/Caio Reis<\/strong>: (ainda|\d+ dias)/.test(mail.html));
    assert.equal(store.get('aliReports/nutri-1').weeklyKey, '2026-10-12');
  });

  await check('não repete na mesma semana; na semana seguinte envia de novo', async () => {
    context.later = new Date('2026-10-14T15:00:00Z');
    assert.deepEqual({ ...(await run('runWeeklySummaries(db, lastSeen, later)')) }, { checked: 1, sent: 0, skipped: 1, failed: 0 });
    assert.equal(google.sent.length, 1);
    context.nextWeek = new Date('2026-10-19T10:00:00Z');
    assert.equal((await run('runWeeklySummaries(db, lastSeen, nextWeek)')).sent, 1);
    assert.equal(google.sent.length, 2);
    // Uma semana depois: a consulta do dia 25 entrou na janela e sobrou uma refeição dentro dos 7 dias.
    assert.match(google.sent[1].html, /domingo, 25\/10, às 10:00: <strong>Longe<\/strong>/);
    assert.match(google.sent[1].html, /<strong>Ana Souza<\/strong>: 1 refeição anotada pela Ali<\/li>/);
    assert.match(google.sent[1].html, /<strong>Ana Souza<\/strong>: 8 dias sem abrir o app/);
  });

  await check('quem desligou o resumo, não conectou o Google ou não tem pacientes fica de fora', async () => {
    store.set('users/nutri-off', { role: 'nutritionist', displayName: 'Desligou' });
    store.set('nutritionistSettings/nutri-off', { ali: { weeklySummary: false } });
    connect('nutri-off', 'off@exemplo.com');
    store.set('patients/p-off', { name: 'Paciente Off', nutritionistId: 'nutri-off' });
    store.set('users/nutri-sem-google', { role: 'nutritionist', displayName: 'Sem Google' });
    store.set('patients/p-sg', { name: 'Paciente SG', nutritionistId: 'nutri-sem-google' });
    store.set('users/nutri-vazia', { role: 'nutritionist', displayName: 'Sem Pacientes' });
    connect('nutri-vazia', 'vazia@exemplo.com');
    store.set('users/p-ana', { role: 'patient' });
    context.week3 = new Date('2026-10-26T10:00:00Z');
    assert.deepEqual({ ...(await run('runWeeklySummaries(db, lastSeen, week3)')) }, { checked: 4, sent: 1, skipped: 3, failed: 0 });
    assert.equal(google.sent.length, 3);
    // Semana sem nada: o e-mail diz isso em vez de sair com listas vazias.
    assert.equal(google.sent[2].to, 'carla@exemplo.com');
    assert.match(google.sent[2].html, /Nenhuma consulta marcada\./);
    assert.match(google.sent[2].html, /Ninguém anotou refeições pela Ali nem registrou peso nesta semana\./);
    assert.equal(run("sanitizeAliSettings({}).weeklySummary"), true);
    assert.equal(run("sanitizeAliSettings({ weeklySummary: 'não' }).weeklySummary"), true);
    assert.equal(run("sanitizeAliSettings({ weeklySummary: false }).weeklySummary"), false);
  });

  await check('sem a informação de acesso, o resumo sai sem a lista de sumidos; falha de envio não derruba as outras', async () => {
    context.broken = async () => { throw new Error('login fora do ar'); };
    context.week4 = new Date('2026-11-02T10:00:00Z');
    store.set('users/nutri-2', { role: 'nutritionist', displayName: 'Outra Nutri' });
    store.set('googleConnections/nutri-2', { status: 'connected', email: 'email inválido', refreshToken: run("encrypt(getGoogleConfig(), 'autorizacao-de-teste')") });
    const totals = await run('runWeeklySummaries(db, broken, week4)');
    assert.deepEqual({ ...totals }, { checked: 5, sent: 1, skipped: 3, failed: 1 });
    assert.ok(!google.sent.at(-1).html.includes('Quem está sumido'));
    assert.equal(store.get('aliReports/nutri-2'), undefined);
  });

  await check('relatório de uso: só números, separados por quem usou, com as falhas à parte', async () => {
    const at = (n) => daysAgo(n).toISOString();
    store.set('aiActions/a1', { patientUid: 'p-ana', nutritionistId: 'nutri-1', action: 'log_meal', result: 'completed', createdAt: at(1) });
    store.set('aiActions/a2', { patientUid: 'p-ana', nutritionistId: 'nutri-1', action: 'log_meal', result: 'completed', createdAt: at(2) });
    store.set('aiActions/a3', { patientUid: 'p-joao', nutritionistId: 'nutri-1', action: 'book_appointment', result: 'completed', createdAt: at(3) });
    store.set('aiActions/a4', { patientUid: null, nutritionistId: 'nutri-1', actor: 'nutritionist', action: 'send_email', result: 'completed', createdAt: at(1) });
    store.set('aiActions/a5', { patientUid: 'p-ana', nutritionistId: null, action: 'book_appointment', result: 'failed', createdAt: at(1) });
    store.set('aiActions/antiga', { patientUid: 'p-bia', nutritionistId: 'nutri-1', action: 'log_meal', result: 'completed', createdAt: at(10) });
    const report = JSON.parse(JSON.stringify(await run('usageReport(db, now)')));
    assert.deepEqual(report.usage, {
      completed: 4, failed: 1, byPatients: 3, byNutritionists: 1, activePatients: 2, activeNutritionists: 1,
      byAction: { log_meal: 2, book_appointment: 1, send_email: 1 }, failedByAction: { book_appointment: 1 },
    });
    assert.deepEqual(report.totals, { nutritionists: 5, googleConnected: 4, patients: 7 });
    assert.equal(report.from, daysAgo(7).toISOString());
    const text = JSON.stringify(report);
    assert.ok(!/Ana|Carla|exemplo\.com|p-ana|nutri-1/.test(text));
  });

  console.log(`${count} verificações do resumo semanal e do relatório de uso passaram. Nenhum serviço externo foi chamado.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
