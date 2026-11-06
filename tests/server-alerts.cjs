// Testa o aviso de erros do servidor: registro, e-mail ao responsável, espaçamento de 6 horas, teto diário,
// erro resolvido que volta e o e-mail de teste. Firestore e Gmail simulados; nenhum serviço externo é chamado.
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createFirestore, createGoogle, loadLib } = require('./fakes.cjs');

const { store, db, FieldValue } = createFirestore();
const google = createGoogle();
const context = loadLib(
  ['ali-settings.ts', 'agenda.ts', 'google-workspace.ts', 'crn.ts', 'nutritionist-approval.ts', 'server-alerts.ts'],
  { FieldValue, fetch: google.fetch },
);
context.db = db;
context.process.env.ADMIN_EMAILS = 'dono@exemplo.com';
const run = (code) => vm.runInContext(code, context);
const plain = (value) => JSON.parse(JSON.stringify(value));
const HOUR = 3_600_000;
const at = (ms) => { context.now = new Date(Date.parse('2026-10-17T13:00:00Z') + ms); };
const alertOf = (label) => store.get(`serverAlerts/${run(`alertId(${JSON.stringify(label)})`)}`);

let count = 0;
async function check(name, fn) { google.sent.length = 0; await fn(); count++; }

(async () => {
  const token = run("encrypt(getGoogleConfig(), 'autorizacao-de-teste')");
  store.set('users/admin-1', { role: 'nutritionist', email: 'dono@exemplo.com', displayName: 'Dono' });
  store.set('googleConnections/admin-1', { status: 'connected', email: 'dono@exemplo.com', refreshToken: token });
  const LABEL = 'Lembretes: falha ao processar.';

  await check('código técnico: só o código, nunca a mensagem do erro', async () => {
    context.e1 = Object.assign(new Error('Ana Souza pesa 72 kg'), { code: 'auth/user-not-found' });
    assert.equal(run('errorCode(e1)'), 'auth/user-not-found');
    assert.equal(run('errorCode({ status: 503 })'), '503');
    assert.equal(run("errorCode(new TypeError('dados da Ana'))"), 'TypeError');
    assert.equal(run("errorCode({ code: 'texto com espaços e dados' })"), '');
    assert.equal(run("errorCode('Ana')"), '');
    assert.equal(run('errorCode(undefined)'), '');
  });

  await check('primeira vez: registra e avisa o responsável na hora, sem dados de pacientes', async () => {
    at(0);
    context.err = Object.assign(new Error('Ana Souza pesa 72 kg'), { code: 14 });
    const result = plain(await run(`handleServerError(db, ${JSON.stringify(LABEL)}, errorCode(err), now)`));
    assert.deepEqual([result.times, result.emailed], [1, 1]);
    assert.deepEqual(google.sent.map((m) => [m.to, m.subject]), [['dono@exemplo.com', `Erro no servidor do NutriAli: ${LABEL}`]]);
    assert.match(google.sent[0].html, /Lembretes: falha ao processar\./);
    assert.match(google.sent[0].html, /Código técnico:<\/strong> 14/);
    assert.match(google.sent[0].html, /\/admin\/erros/);
    assert.ok(!google.sent[0].html.includes('Ana'));
    const saved = alertOf(LABEL);
    assert.deepEqual([saved.label, saved.code, saved.count, saved.pending, saved.notifiedAt, saved.resolvedAt], [LABEL, '14', 1, 0, context.now.toISOString(), null]);
  });

  await check('repetido em menos de 6 horas: só soma (com as repetições da memória), sem outro e-mail', async () => {
    at(1 * HOUR);
    await run(`handleServerError(db, ${JSON.stringify(LABEL)}, '', now)`);
    at(2 * HOUR);
    await run(`handleServerError(db, ${JSON.stringify(LABEL)}, '', now, 3)`);
    assert.equal(google.sent.length, 0);
    const saved = alertOf(LABEL);
    assert.deepEqual([saved.count, saved.pending, saved.code, saved.lastAt], [6, 5, '14', context.now.toISOString()]);
  });

  await check('6 horas depois do aviso: novo e-mail com a contagem do período', async () => {
    at(6 * HOUR);
    const result = plain(await run(`handleServerError(db, ${JSON.stringify(LABEL)}, '503', now)`));
    assert.equal(result.emailed, 1);
    assert.match(google.sent[0].html, /<strong>6 vezes<\/strong> desde o último aviso/);
    assert.match(google.sent[0].html, /Primeira vez registrada/);
    const saved = alertOf(LABEL);
    assert.deepEqual([saved.count, saved.pending, saved.code, saved.notifiedAt], [7, 0, '503', context.now.toISOString()]);
  });

  await check('marcado como resolvido: sai da lista em aberto e, se voltar, avisa na hora', async () => {
    const id = run(`alertId(${JSON.stringify(LABEL)})`);
    at(7 * HOUR);
    context.id = id;
    assert.deepEqual(plain(await run('resolveServerAlert(db, id, now)')), { ok: true });
    assert.equal(plain(await run('listServerAlerts(db)'))[0].open, false);
    for (const bad of ['', 'x', '../serverAlerts', 'f'.repeat(24)]) {
      context.bad = bad;
      assert.equal(plain(await run('resolveServerAlert(db, bad, now)')).status, bad === 'f'.repeat(24) ? 404 : 400);
    }
    at(8 * HOUR);
    const result = plain(await run(`handleServerError(db, ${JSON.stringify(LABEL)}, '', now)`));
    assert.equal(result.emailed, 1);
    const rows = plain(await run('listServerAlerts(db)'));
    assert.deepEqual([rows[0].id, rows[0].open, rows[0].count], [id, true, 8]);
  });

  await check('lista: os em aberto primeiro, do mais recente para o mais antigo', async () => {
    at(9 * HOUR);
    await run("handleServerError(db, 'Exportação: falha ao reunir os dados.', '', now)");
    at(10 * HOUR);
    await run("handleServerError(db, 'Perfil do paciente: falha ao gravar.', '', now)");
    context.id = run("alertId('Exportação: falha ao reunir os dados.')");
    await run('resolveServerAlert(db, id, now)');
    const rows = plain(await run('listServerAlerts(db)'));
    assert.deepEqual(rows.map((r) => [r.label, r.open]), [
      ['Perfil do paciente: falha ao gravar.', true],
      [LABEL, true],
      ['Exportação: falha ao reunir os dados.', false],
    ]);
    assert.equal(await run("handleServerError(db, '   ', '', now)"), null);
  });

  await check('sem Gmail de responsável conectado: o erro fica registrado e o teste avisa o motivo', async () => {
    store.delete('googleConnections/admin-1');
    // O acesso ao Google fica guardado na memória por um tempo: um processo novo não teria esse atalho.
    run('accessCache.clear()');
    at(11 * HOUR);
    const result = plain(await run("handleServerError(db, 'Consulta manual: falha ao gravar.', '', now)"));
    assert.deepEqual([result.times, result.emailed], [1, 0]);
    assert.equal(google.sent.length, 0);
    const saved = alertOf('Consulta manual: falha ao gravar.');
    assert.deepEqual([saved.pending, saved.notifiedAt], [1, null]);
    assert.deepEqual(plain(await run('alertEmailStatus(db)')), { ready: false, recipients: 1 });
    const test = plain(await run('sendTestAlert(db, now)'));
    assert.equal(test.status, 409);
    assert.match(test.error, /Google conectado/);
    // Ao reconectar, o próximo erro avisa com a contagem acumulada.
    store.set('googleConnections/admin-1', { status: 'connected', email: 'dono@exemplo.com', refreshToken: token });
    at(11.5 * HOUR);
    assert.equal(plain(await run("handleServerError(db, 'Consulta manual: falha ao gravar.', '', now)")).emailed, 1);
    assert.match(google.sent[0].html, /<strong>2 vezes<\/strong>/);
  });

  await check('teto do dia: no máximo 12 e-mails, o resto fica só registrado', async () => {
    context.now = new Date('2026-10-20T09:00:00Z');
    let emailed = 0;
    for (let i = 1; i <= 13; i++) emailed += plain(await run(`handleServerError(db, 'Erro de teste número ${i}.', '', now)`)).emailed;
    assert.equal(emailed, 12);
    assert.equal(google.sent.length, 12);
    assert.deepEqual([alertOf('Erro de teste número 13.').count, alertOf('Erro de teste número 13.').notifiedAt], [1, null]);
    // No dia seguinte o teto recomeça.
    context.now = new Date('2026-10-21T09:00:00Z');
    assert.equal(plain(await run("handleServerError(db, 'Erro de teste número 13.', '', now)")).emailed, 1);
  });

  await check('e-mail de teste: chega para o responsável e diz que os avisos estão prontos', async () => {
    assert.deepEqual(plain(await run('alertEmailStatus(db)')), { ready: true, recipients: 1 });
    assert.deepEqual(plain(await run('sendTestAlert(db, now)')), { ok: true, sent: 1 });
    assert.deepEqual(google.sent.map((m) => [m.to, m.subject]), [['dono@exemplo.com', 'Teste do aviso de erros do NutriAli']]);
  });

  console.log(`${count} verificações do aviso de erros do servidor passaram. Nenhum serviço externo foi chamado.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
