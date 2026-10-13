// Testa a aprovação do cadastro de nutricionistas: leitura do CRN, quem pode aprovar, o pedido que avisa o
// responsável por e-mail e a decisão que libera (ou não) a conta. Firestore e Gmail simulados; nada externo é chamado.
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createFirestore, createGoogle, loadLib } = require('./fakes.cjs');

const { store, db, FieldValue } = createFirestore();
const google = createGoogle();
const context = loadLib(
  ['daily-log.ts', 'ali-settings.ts', 'agenda.ts', 'google-workspace.ts', 'crn.ts', 'nutritionist-approval.ts'],
  { FieldValue, fetch: google.fetch },
);
context.db = db;
context.process.env.ADMIN_EMAILS = 'Dono@Exemplo.com, socia@exemplo.com';
const run = (code) => vm.runInContext(code, context);
const plain = (value) => JSON.parse(JSON.stringify(value));
context.now = new Date('2026-10-12T15:00:00Z');

let count = 0;
async function check(name, fn) { await fn(); count++; }

(async () => {
  await check('CRN: aceita as formas comuns de escrever e devolve sempre no mesmo formato', async () => {
    const crn = (text) => { context.text = text; return plain(run('parseCrn(text)')); };
    assert.deepEqual(crn('CRN-3 12345'), { ok: true, crn: 'CRN-3 12345', region: 3, number: '12345' });
    for (const same of ['crn3 12345', ' CRN 3 / 12.345 ', '3-12345', 'CRN-3/12345', 'crn.3 12345']) assert.equal(crn(same).crn, 'CRN-3 12345');
    assert.equal(crn('CRN-11 987').crn, 'CRN-11 987');
    // A letra no fim (inscrição provisória, por exemplo) é mantida.
    assert.equal(crn('crn-4 2010012/p').crn, 'CRN-4 2010012/P');
    assert.equal(crn('CRN-4 2010012 P').number, '2010012/P');
    for (const bad of ['', '   ', '12345', 'CRN-12 12345', 'CRN-0 12345', 'CRN-3', 'CRN-3 1', 'CRN-3 123456789', 'nutricionista', 'CRN-3 12345 extra', null, 12345, { crn: 'CRN-3 12345' }]) {
      assert.equal(crn(bad).ok, false);
    }
    assert.match(crn('CRN-12 12345').error, /1 a 11/);
    assert.match(crn('abc').error, /CRN-3 12345/);
  });

  await check('quem aprova: só e-mail da lista do servidor e confirmado', async () => {
    assert.deepEqual(plain(run('adminEmails()')), ['dono@exemplo.com', 'socia@exemplo.com']);
    assert.deepEqual(plain(run("adminEmails(' a@b.com ; nao-e-email ,, c@d.com')")), ['a@b.com', 'c@d.com']);
    assert.deepEqual(plain(run("adminEmails('')")), []);
    assert.equal(run("isAdmin('DONO@exemplo.com', true)"), true);
    assert.equal(run("isAdmin('dono@exemplo.com', false)"), false); // cadastro por senha sem confirmar o e-mail
    assert.equal(run("isAdmin('dono@exemplo.com', 'true')"), false);
    assert.equal(run("isAdmin('outra@exemplo.com', true)"), false);
    assert.equal(run("isAdmin(null, true)"), false);
    assert.equal(run("isAdmin('dono@exemplo.com', true, '')"), false); // sem lista no servidor, ninguém aprova
  });

  await check('situação do cadastro: contas antigas, sem o campo, continuam aprovadas', async () => {
    const of = (profile) => { context.profile = profile; return run('approvalOf(profile)'); };
    assert.equal(of({ role: 'nutritionist' }), 'approved');
    assert.equal(of({ role: 'nutritionist', approval: 'pending' }), 'pending');
    assert.equal(of({ role: 'nutritionist', approval: 'rejected' }), 'rejected');
    assert.equal(of({ role: 'nutritionist', approval: 'qualquer coisa' }), 'approved');
    assert.equal(of(null), 'approved');
  });

  // O responsável tem o Gmail conectado no app: é por ele que os avisos saem.
  store.set('users/dono', { role: 'nutritionist', email: 'dono@exemplo.com', displayName: 'Dono' });
  store.set('googleConnections/dono', { status: 'connected', email: 'dono@exemplo.com', refreshToken: run("encrypt(getGoogleConfig(), 'autorizacao-de-teste')") });
  const submit = async (uid, input) => { context.uid = uid; context.input = input; return plain(await run('submitApproval(db, uid, input, now)')); };

  await check('pedido: confere o CRN, guarda os dados e avisa os responsáveis uma vez só', async () => {
    store.set('users/n-nova', { role: 'nutritionist', approval: 'pending', email: 'bia@exemplo.com', displayName: 'Bia <b>Lima</b>', createdAt: '2026-10-12T14:00:00.000Z' });
    assert.deepEqual(await submit('n-nova', { crn: 'crn3 12.345', specialty: ' Nutrição Esportiva ', phone: '(11) 98888-7777' }),
      { ok: true, approval: 'pending', crn: 'CRN-3 12345', notified: true });
    const saved = store.get('users/n-nova');
    assert.equal(saved.crn, 'CRN-3 12345');
    assert.equal(saved.specialty, 'Nutrição Esportiva');
    assert.equal(saved.approval, 'pending');
    assert.equal(saved.approvalRequestedAt, '2026-10-12T15:00:00.000Z');
    assert.equal(saved.approvalNotifiedAt, '2026-10-12T15:00:00.000Z');
    assert.equal(google.sent.length, 2); // um para cada responsável
    const [mail] = google.sent;
    assert.deepEqual(google.sent.map((m) => m.to), ['dono@exemplo.com', 'socia@exemplo.com']);
    assert.match(mail.subject, /Nutricionista aguardando aprovação: Bia/);
    assert.match(mail.html, /Bia &lt;b&gt;Lima&lt;\/b&gt;/);
    assert.match(mail.html, /CRN-3 12345/);
    assert.match(mail.html, /app\.nutriali\.cloud\/admin\/aprovacoes/);
    assert.match(mail.html, /cnn\.cfn\.org\.br/);
    // Abrir a tela de novo (mesmos dados) não manda outro e-mail.
    assert.equal((await submit('n-nova', {})).notified, true);
    assert.equal(google.sent.length, 2);
    // Corrigir o CRN gera um aviso novo, com o dado certo.
    assert.equal((await submit('n-nova', { crn: 'CRN-3 54321' })).crn, 'CRN-3 54321');
    assert.equal(google.sent.length, 4);
    assert.match(google.sent[3].html, /CRN-3 54321/);
  });

  await check('pedido recusado não grava nada; conta que não é de nutricionista não entra', async () => {
    store.set('users/n-google', { role: 'nutritionist', approval: 'pending', email: 'gui@exemplo.com', displayName: 'Gui' });
    const before = google.sent.length;
    for (const [input, pattern] of [[{}, /Informe o seu CRN/], [{ crn: 'CRN-30 1' }, /região e o número|1 a 11/], [{ crn: 'CRN-2 4455' }, /especialidade/], [{ crn: 'CRN-2 4455', specialty: 'Clínica' }, /telefone/]]) {
      const result = await submit('n-google', input);
      assert.equal(result.ok, false);
      assert.equal(result.status, 422);
      assert.match(result.error, pattern);
    }
    assert.equal(store.get('users/n-google').crn, undefined);
    assert.equal(google.sent.length, before);
    store.set('users/paciente', { role: 'patient', email: 'p@exemplo.com' });
    assert.equal((await submit('paciente', { crn: 'CRN-3 12345' })).status, 403);
    assert.equal((await submit('nao-existe', { crn: 'CRN-3 12345' })).status, 403);
    // Quem já foi aprovada (ou é conta antiga) não volta para a análise nem gera aviso.
    store.set('users/n-antiga', { role: 'nutritionist', email: 'antiga@exemplo.com', crn: 'CRN-1 111' });
    assert.deepEqual(await submit('n-antiga', { crn: 'CRN-1 222' }), { ok: true, approval: 'approved', crn: 'CRN-1 111', notified: false });
    assert.equal(store.get('users/n-antiga').crn, 'CRN-1 111');
  });

  await check('sem Gmail conectado o aviso não sai, o pedido fica registrado e a nova tentativa espera uma hora', async () => {
    const connection = store.get('googleConnections/dono');
    store.delete('googleConnections/dono');
    run('accessCache.clear()'); // sem isto, o acesso já obtido continuaria valendo por uma hora
    const before = google.sent.length;
    const first = await submit('n-google', { crn: 'CRN-2 4455', specialty: 'Clínica', phone: '11 97777-0000' });
    assert.deepEqual(first, { ok: true, approval: 'pending', crn: 'CRN-2 4455', notified: false });
    assert.equal(store.get('users/n-google').approvalNotifiedAt, undefined);
    assert.equal(store.get('users/n-google').approvalNotifyTriedAt, '2026-10-12T15:00:00.000Z');
    store.set('googleConnections/dono', connection);
    context.now = new Date('2026-10-12T15:20:00Z');
    assert.equal((await submit('n-google', {})).notified, false); // ainda dentro da espera
    assert.equal(google.sent.length, before);
    context.now = new Date('2026-10-12T16:05:00Z');
    assert.equal((await submit('n-google', {})).notified, true);
    assert.equal(google.sent.length, before + 2);
    context.now = new Date('2026-10-12T15:00:00Z');
  });

  const decide = async (uid, decision) => { context.uid = uid; context.decision = decision; return plain(await run("decideApproval(db, 'Dono@Exemplo.com', uid, decision, now)")); };

  await check('lista: quem espera vem primeiro; contas antigas não aparecem', async () => {
    const list = plain(await run('listApprovals(db)'));
    assert.deepEqual(list.map((item) => item.uid), ['n-nova', 'n-google']);
    assert.deepEqual(list[0], { uid: 'n-nova', name: 'Bia <b>Lima</b>', email: 'bia@exemplo.com', crn: 'CRN-3 54321', specialty: 'Nutrição Esportiva', phone: '(11) 98888-7777', approval: 'pending', requestedAt: '2026-10-12T15:00:00.000Z', decidedAt: '' });
  });

  await check('decisão: aprovar libera a conta, registra quem decidiu e avisa a nutricionista', async () => {
    const before = google.sent.length;
    assert.deepEqual(await decide('n-nova', 'approve'), { ok: true, approval: 'approved', emailed: true });
    const saved = store.get('users/n-nova');
    assert.equal(saved.approval, 'approved');
    assert.equal(saved.approvalDecidedBy, 'dono@exemplo.com');
    assert.equal(saved.approvalDecidedAt, '2026-10-12T15:00:00.000Z');
    const mail = google.sent[before];
    assert.equal(mail.to, 'bia@exemplo.com');
    assert.match(mail.subject, /foi aprovado/);
    assert.match(mail.html, /app\.nutriali\.cloud\/login/);
    // Repetir a mesma decisão não manda outro e-mail.
    assert.deepEqual(await decide('n-nova', 'approve'), { ok: true, approval: 'approved', emailed: false });
    assert.equal(google.sent.length, before + 1);
    assert.deepEqual(await decide('n-google', 'reject'), { ok: true, approval: 'rejected', emailed: true });
    assert.match(google.sent[before + 1].subject, /Sobre o seu cadastro/);
    assert.match(google.sent[before + 1].html, /CRN-2 4455/);
    // Uma recusa pode ser revista depois.
    assert.equal((await decide('n-google', 'approve')).approval, 'approved');
    const list = plain(await run('listApprovals(db)'));
    assert.equal(list.every((item) => item.approval === 'approved'), true);
  });

  await check('decisão: só vale para cadastro que passou pela análise, com pedido bem formado', async () => {
    assert.equal((await decide('n-antiga', 'reject')).status, 404); // conta antiga, sem o campo
    assert.equal(store.get('users/n-antiga').approval, undefined);
    assert.equal((await decide('paciente', 'approve')).status, 404);
    assert.equal((await decide('nao-existe', 'approve')).status, 404);
    for (const [uid, decision] of [['n-nova', 'apagar'], ['n-nova', undefined], ['', 'approve'], [null, 'approve'], ['a/b', 'approve'], [{ uid: 'n-nova' }, 'approve']]) {
      assert.equal((await decide(uid, decision)).status, 422);
    }
    // Sem Gmail para enviar, a decisão vale do mesmo jeito.
    store.set('users/n-tarde', { role: 'nutritionist', approval: 'pending', email: 'tarde@exemplo.com', displayName: 'Tarde', crn: 'CRN-5 777' });
    store.delete('googleConnections/dono');
    run('accessCache.clear()');
    assert.deepEqual(await decide('n-tarde', 'approve'), { ok: true, approval: 'approved', emailed: false });
    assert.equal(store.get('users/n-tarde').approval, 'approved');
  });

  console.log(`${count} verificações da aprovação de nutricionistas passaram. Nenhum serviço externo foi chamado.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
