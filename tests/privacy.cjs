// Testa o básico da LGPD: aceite do termo, "baixar meus dados" e o pedido de exclusão (registro, avisos e a decisão
// do responsável). Firestore e Gmail simulados; nenhum serviço externo é chamado.
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createFirestore, createGoogle, loadLib } = require('./fakes.cjs');

const { store, db, FieldValue } = createFirestore();
const google = createGoogle();
const context = loadLib(
  ['ali-settings.ts', 'agenda.ts', 'google-workspace.ts', 'crn.ts', 'nutritionist-approval.ts', 'privacy.ts', 'account-privacy.ts'],
  { FieldValue, fetch: google.fetch },
);
context.db = db;
context.process.env.ADMIN_EMAILS = 'dono@exemplo.com';
const run = (code) => vm.runInContext(code, context);
const plain = (value) => JSON.parse(JSON.stringify(value));
const NOW = new Date('2026-10-15T13:00:00Z');
context.now = NOW;

let count = 0;
async function check(name, fn) { google.sent.length = 0; await fn(); count++; }

(async () => {
  const token = run("encrypt(getGoogleConfig(), 'autorizacao-de-teste')");
  store.set('users/admin-1', { role: 'nutritionist', email: 'dono@exemplo.com', displayName: 'Dono' });
  store.set('googleConnections/admin-1', { status: 'connected', email: 'dono@exemplo.com', refreshToken: token });
  store.set('users/nutri-1', { role: 'nutritionist', email: 'carla@exemplo.com', displayName: 'Dra. Carla Mendes' });
  store.set('googleConnections/nutri-1', { status: 'connected', email: 'carla@exemplo.com', refreshToken: token });
  store.set('users/p-ana', { role: 'patient', email: 'ana@exemplo.com', displayName: 'Ana Souza', waterIntake: { amount: 500, date: '2026-10-15' }, approval: 'x', privacyConsent: { version: '2026-10-15', acceptedAt: '2026-10-15T12:00:00.000Z' } });
  store.set('patients/p-ana', {
    name: 'Ana Souza', email: 'ana@exemplo.com', nutritionistId: 'nutri-1', nutritionistName: 'Dra. Carla Mendes', weight: 72.4,
    currentPlan: { status: 'approved', days: [{ name: 'Seg', meals: [] }] }, pendingPlan: { status: 'draft' }, planDraftJob: { status: 'done' },
  });
  store.set('patients/p-ana/foodLogs/l2', { description: 'Jantar', loggedAt: '2026-10-14T22:00:00.000Z' });
  store.set('patients/p-ana/foodLogs/l1', { description: 'Almoço', loggedAt: '2026-10-14T15:00:00.000Z' });
  store.set('chats/p-ana_nutri-1', { updatedAt: NOW });
  store.set('chats/p-ana_nutri-1/messages/m1', { senderId: 'nutri-1', senderName: 'Dra. Carla Mendes', senderRole: 'nutritionist', text: 'Oi, Ana!', createdAt: '2026-10-14T10:00:00.000Z' });
  store.set('chats/p-ana_nutri-1/messages/m2', { senderId: 'p-ana', senderName: 'Ana', senderRole: 'patient', text: 'Oi!', createdAt: '2026-10-14T10:05:00.000Z' });
  store.set('appointmentRequests/r1', { patientUid: 'p-ana', nutritionistId: 'nutri-1', preferredDate: 'sexta', status: 'confirmed', createdAt: '2026-10-10T10:00:00.000Z', appointmentLabel: 'sexta, 17' });
  store.set('aliAppointments/nutri-1_e1', { patientUid: 'p-ana', nutritionistId: 'nutri-1', label: 'sexta, 17', startLocal: '2026-10-17T09:00:00-03:00', mode: 'online', status: 'scheduled' });
  store.set('consultationNotes/n1', { nutritionistId: 'nutri-1', patientUid: 'p-ana', text: 'Anotação reservada da nutricionista', createdAt: '2026-10-14T11:00:00.000Z' });
  store.set('aiActions/a1', { nutritionistId: 'nutri-1', patientUid: 'p-ana', action: 'log_meal', result: 'completed' });
  store.set('patientNotices/p-ana', { chatNotifiedAt: '2026-10-14T10:20:00.000Z' });
  // Dados de outra paciente que não podem ser tocados.
  store.set('patients/p-bia', { name: 'Bia Costa', nutritionistId: 'nutri-1' });
  store.set('appointmentRequests/r2', { patientUid: 'p-bia', nutritionistId: 'nutri-1', status: 'pending' });
  store.set('consultationNotes/n2', { nutritionistId: 'nutri-1', patientUid: 'p-bia', text: 'Outra' });

  await check('aceite do termo: só vale a versão em vigor', async () => {
    assert.equal(run("hasCurrentConsent({ privacyConsent: newConsent(now) })"), true);
    assert.equal(run("hasCurrentConsent({ privacyConsent: { version: '2020-01-01', acceptedAt: 'x' } })"), false);
    assert.equal(run('hasCurrentConsent({})'), false);
    assert.equal(run('hasCurrentConsent(null)'), false);
    assert.deepEqual(plain(run('newConsent(now)')), { version: run('PRIVACY_VERSION'), acceptedAt: NOW.toISOString() });
  });

  await check('baixar meus dados: o que é dela, sem rascunhos, campos internos nem anotações da nutricionista', async () => {
    const data = plain(await run("exportPatientData(db, 'p-ana', now)"));
    assert.equal(data.sobreEsteArquivo.contato, 'nutriali44@gmail.com');
    assert.equal(data.conta.displayName, 'Ana Souza');
    assert.equal(data.conta.approval, undefined);
    assert.equal(data.prontuario.weight, 72.4);
    assert.equal(data.prontuario.currentPlan.status, 'approved');
    assert.equal(data.prontuario.pendingPlan, undefined);
    assert.equal(data.prontuario.planDraftJob, undefined);
    assert.deepEqual(data.refeicoesRegistradas.map((l) => l.description), ['Almoço', 'Jantar']);
    assert.deepEqual(data.conversaComNutricionista.map((m) => [m.de, m.texto]), [['Dra. Carla Mendes', 'Oi, Ana!'], ['você', 'Oi!']]);
    assert.deepEqual(data.pedidosDeConsulta, [{ preferencia: 'sexta', observacao: '', situacao: 'confirmed', pedidoEm: '2026-10-10T10:00:00.000Z', consultaMarcada: 'sexta, 17' }]);
    assert.deepEqual(data.consultas, [{ quando: 'sexta, 17', inicio: '2026-10-17T09:00:00-03:00', modo: 'online', situacao: 'marcada' }]);
    assert.ok(!JSON.stringify(data).includes('Anotação reservada'));
    assert.ok(!JSON.stringify(data).includes('Bia'));
    // Plano ainda em rascunho não sai.
    store.set('patients/p-x', { name: 'X', currentPlan: { status: 'draft' } });
    assert.equal(plain(await run("exportPatientData(db, 'p-x', now)")).prontuario.currentPlan, undefined);
  });

  await check('pedido de exclusão: registra, avisa o responsável e a nutricionista, e não duplica', async () => {
    context.profile = store.get('users/p-ana');
    context.reason = '  Não uso mais o app.  ' + 'x'.repeat(600);
    const result = plain(await run("requestDeletion(db, 'p-ana', profile, reason, now)"));
    assert.equal(result.ok, true);
    assert.equal(result.adminNotified, true);
    assert.deepEqual(result.deletion, { status: 'pending', requestedAt: NOW.toISOString(), decidedAt: null });
    const saved = store.get('deletionRequests/p-ana');
    assert.deepEqual([saved.role, saved.name, saved.email, saved.nutritionistId, saved.status], ['patient', 'Ana Souza', 'ana@exemplo.com', 'nutri-1', 'pending']);
    assert.equal(saved.reason.length, 500);
    assert.ok(saved.reason.startsWith('Não uso mais o app.'));
    assert.deepEqual(google.sent.map((m) => [m.to, m.subject]), [
      ['dono@exemplo.com', 'Pedido de exclusão de conta: Ana Souza'],
      ['carla@exemplo.com', 'Pedido de exclusão de dados: Ana Souza'],
    ]);
    assert.match(google.sent[0].html, /\/admin\/exclusoes/);
    assert.match(google.sent[0].html, /em até 15 dias/);
    assert.match(google.sent[1].html, /nutriali44@gmail\.com/);
    // Pedir de novo enquanto espera: nada muda e nenhum e-mail sai.
    google.sent.length = 0;
    assert.equal(plain(await run("requestDeletion(db, 'p-ana', profile, '', now)")).deletion.requestedAt, NOW.toISOString());
    assert.equal(google.sent.length, 0);
    assert.deepEqual(plain(await run("deletionStatusOf(db, 'p-ana')")), { status: 'pending', requestedAt: NOW.toISOString(), decidedAt: null });
    assert.equal(await run("deletionStatusOf(db, 'p-bia')"), null);
    assert.equal(plain(await run("requestDeletion(db, 'p-y', null, '', now)")).status, 403);
  });

  await check('decisão do responsável: manter a conta, e conta de nutricionista não é apagada por aqui', async () => {
    store.set('users/nutri-2', { role: 'nutritionist', email: 'outra@exemplo.com', displayName: 'Outra Nutri' });
    context.profile = store.get('users/nutri-2');
    await run("requestDeletion(db, 'nutri-2', profile, '', now)");
    context.erased = [];
    context.deleteLogin = async (uid) => { context.erased.push(uid); };
    const refused = plain(await run("decideDeletion(db, 'dono@exemplo.com', 'nutri-2', 'delete', deleteLogin, now)"));
    assert.equal(refused.status, 409);
    assert.match(refused.error, /nutricionista/);
    assert.deepEqual(plain(await run("decideDeletion(db, 'dono@exemplo.com', 'nutri-2', 'keep', deleteLogin, now)")), { ok: true, status: 'kept' });
    assert.equal(store.get('deletionRequests/nutri-2').decidedBy, 'dono@exemplo.com');
    assert.ok(store.has('users/nutri-2'));
    assert.equal(plain(await run("decideDeletion(db, 'dono@exemplo.com', 'nutri-2', 'keep', deleteLogin, now)")).status, 409);
    for (const [uid, decision] of [['', 'keep'], ['../x', 'keep'], ['p-ana', 'talvez']]) {
      context.u = uid; context.d = decision;
      assert.equal(plain(await run("decideDeletion(db, 'dono@exemplo.com', u, d, deleteLogin, now)")).status, 400);
    }
    const rows = plain(await run('listDeletionRequests(db)'));
    assert.deepEqual(rows.map((r) => [r.uid, r.status]), [['p-ana', 'pending'], ['nutri-2', 'kept']]);
    assert.equal(context.erased.length, 0);
  });

  await check('apagar os dados da paciente: tudo dela some, o pedido guarda só a prova, e os outros ficam', async () => {
    const result = plain(await run("decideDeletion(db, 'dono@exemplo.com', 'p-ana', 'delete', deleteLogin, now)"));
    assert.deepEqual(result, { ok: true, status: 'deleted' });
    const left = [...store.keys()].filter((key) => key.includes('p-ana') && !key.startsWith('deletionRequests/'));
    assert.deepEqual(left, []);
    for (const key of ['appointmentRequests/r1', 'aliAppointments/nutri-1_e1', 'consultationNotes/n1', 'chats/p-ana_nutri-1']) assert.equal(store.has(key), false, key);
    assert.equal(store.get('aiActions/a1').patientUid, null);
    assert.deepEqual(context.erased, ['p-ana']);
    assert.deepEqual(store.get('deletionRequests/p-ana'), { uid: 'p-ana', role: 'patient', requestedAt: NOW.toISOString(), status: 'deleted', decidedAt: NOW.toISOString(), decidedBy: 'dono@exemplo.com' });
    // Os dados de outra paciente e os da nutricionista continuam.
    for (const key of ['patients/p-bia', 'appointmentRequests/r2', 'consultationNotes/n2', 'users/nutri-1']) assert.ok(store.has(key), key);
  });

  console.log(`${count} verificações da privacidade (LGPD) passaram. Nenhum serviço externo foi chamado.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
