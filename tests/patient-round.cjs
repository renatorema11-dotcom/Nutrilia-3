// Testa a triagem do paciente gravada no prontuário (sem dados inventados), as consultas marcadas à mão
// que aparecem para as duas pontas e o aviso de novo paciente. Firestore e Gmail simulados; nada externo é chamado.
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createFirestore, createGoogle, loadLib } = require('./fakes.cjs');

const { store, db, FieldValue } = createFirestore();
const google = createGoogle();
const context = loadLib(
  ['daily-log.ts', 'ali-settings.ts', 'agenda.ts', 'google-workspace.ts', 'patient-profile.ts', 'manual-appointments.ts'],
  { FieldValue, fetch: google.fetch },
);
context.db = db;
const run = (code) => vm.runInContext(code, context);
const plain = (value) => JSON.parse(JSON.stringify(value));

// Domingo, 11 de outubro de 2026, 10:00 em Brasília.
context.now = new Date('2026-10-11T13:00:00Z');
const triage = { name: ' Ana Souza ', age: '34', height: '165', weight: '72,5', objective: 'Emagrecimento' };

let count = 0;
async function check(name, fn) { await fn(); count++; }

(async () => {
  await check('a triagem é conferida: faixas, vírgula decimal e campos obrigatórios', async () => {
    const validate = (input) => { context.input = input; return plain(run('validateProfile(input)')); };
    assert.deepEqual(validate(triage), { ok: true, profile: { name: 'Ana Souza', age: 34, height: 165, weight: 72.5, objective: 'Emagrecimento' } });
    assert.equal(validate({ ...triage, targetWeight: '65', initialWeight: 80 }).profile.targetWeight, 65);
    assert.equal(validate({ ...triage, targetWeight: '' }).profile.targetWeight, undefined);
    for (const bad of [{ ...triage, age: 0 }, { ...triage, age: 'abc' }, { ...triage, height: 20 }, { ...triage, weight: 900 },
      { ...triage, name: '  ' }, { ...triage, objective: '' }, { ...triage, targetWeight: 5 }, null, 'texto', [triage]]) {
      assert.equal(validate(bad).ok, false);
    }
  });

  await check('cadastro novo: o prontuário recebe só o que o paciente informou, com a medição de hoje', async () => {
    store.set('users/p-novo', { role: 'patient', email: 'ana@exemplo.com', displayName: 'Ana' });
    store.set('patients/p-novo', { id: 'p-novo', name: 'Ana', email: 'ana@exemplo.com', createdAt: '2026-10-11T12:00:00.000Z', measurements: [], currentPlan: null, pastPlans: [] });
    context.input = triage;
    assert.equal((await run("saveProfile(db, 'p-novo', input, now)")).ok, true);
    const record = store.get('patients/p-novo');
    assert.equal(record.age, 34);
    assert.equal(record.weight, 72.5);
    assert.equal(record.initialWeight, 72.5);
    assert.deepEqual(record.measurements, [{ date: '2026-10-11', weight: 72.5, height: 165, source: 'patient' }]);
    assert.equal(record.createdAt, '2026-10-11T12:00:00.000Z');
    assert.equal(store.get('users/p-novo').displayName, 'Ana Souza');
    assert.equal(store.get('users/p-novo').profileSynced, true);
  });

  await check('conta sem prontuário (entrou pelo Google): a triagem cria o prontuário', async () => {
    store.set('users/p-google', { role: 'patient', email: 'g@exemplo.com' });
    context.input = { ...triage, name: 'Gui Lima' };
    await run("saveProfile(db, 'p-google', input, now)");
    const record = store.get('patients/p-google');
    assert.equal(record.id, 'p-google');
    assert.equal(record.email, 'g@exemplo.com');
    assert.equal(record.currentPlan, null);
    assert.equal(record.measurements.length, 1);
  });

  await check('dados recusados não gravam nada', async () => {
    context.input = { ...triage, weight: 5 };
    const result = await run("saveProfile(db, 'p-recusado', input, now)");
    assert.equal(result.ok, false);
    assert.match(result.error, /peso/);
    assert.equal(store.has('patients/p-recusado'), false);
  });

  await check('paciente da nutricionista: o histórico dela fica; peso novo vira medição marcada como do paciente', async () => {
    store.set('users/p-clinica', { role: 'patient', email: 'c@exemplo.com' });
    store.set('patients/p-clinica', {
      id: 'p-clinica', name: 'Caio', nutritionistId: 'nutri-1', age: 40, height: 180, weight: 90, initialWeight: 95, targetWeight: 82,
      objective: 'Emagrecimento', measurements: [{ date: '2026-09-01', weight: 95, height: 180 }, { date: '2026-10-01', weight: 90, bodyFat: 24 }],
      currentPlan: { status: 'approved' },
    });
    context.input = { name: 'Caio Reis', age: 40, height: 180, weight: 89, objective: 'Emagrecimento' };
    await run("saveProfile(db, 'p-clinica', input, now)");
    let record = store.get('patients/p-clinica');
    assert.equal(record.measurements.length, 3);
    assert.deepEqual(record.measurements[2], { date: '2026-10-11', weight: 89, height: 180, source: 'patient' });
    assert.equal(record.initialWeight, 95);
    assert.equal(record.targetWeight, 82);
    assert.equal(record.nutritionistId, 'nutri-1');
    assert.equal(record.currentPlan.status, 'approved');
    // Corrigir o peso no mesmo dia troca a medição de hoje em vez de empilhar outra.
    context.input = { ...context.input, weight: 88.4 };
    await run("saveProfile(db, 'p-clinica', input, now)");
    record = store.get('patients/p-clinica');
    assert.equal(record.measurements.length, 3);
    assert.equal(record.measurements[2].weight, 88.4);
    // Salvar sem mudar peso nem altura não cria medição.
    context.later = new Date('2026-10-20T13:00:00Z');
    await run("saveProfile(db, 'p-clinica', input, later)");
    assert.equal(store.get('patients/p-clinica').measurements.length, 3);
  });

  await check('conta antiga com valores inventados: a triagem guardada à parte passa a valer, uma única vez', async () => {
    const invented = { id: 'p-antigo', name: 'Bia', email: 'b@exemplo.com', age: 30, weight: 70, height: 168, objective: 'Saúde Geral', measurements: [{ date: '2026-09-05', weight: 70, height: 168 }], currentPlan: null, pastPlans: [] };
    store.set('patients/p-antigo', invented);
    store.set('users/p-antigo', { role: 'patient', email: 'b@exemplo.com', displayName: 'Bia',
      patientData: { name: 'Bia Lima', age: '27', height: '158', weight: '61.2', objective: 'Hipertrofia' },
      patientHistory: [{ month: 'Jan', weight: 64.4, fat: 24.5 }] });
    context.record = invented;
    assert.equal(run('isInventedRecord(record)'), true);
    assert.deepEqual(plain(await run("syncLegacyProfile(db, 'p-antigo', now)")), { changed: true });
    const record = store.get('patients/p-antigo');
    assert.equal(record.age, 27);
    assert.equal(record.weight, 61.2);
    assert.equal(record.objective, 'Hipertrofia');
    assert.deepEqual(record.measurements, [{ date: '2026-10-11', weight: 61.2, height: 158, source: 'patient' }]);
    const user = store.get('users/p-antigo');
    assert.equal('patientData' in user, false);
    assert.equal('patientHistory' in user, false);
    assert.equal(user.profileSynced, true);
    assert.deepEqual(plain(await run("syncLegacyProfile(db, 'p-antigo', now)")), { changed: false });
  });

  await check('o conserto não mexe em prontuário de verdade nem inventa quando não há triagem guardada', async () => {
    // 30 anos, 70 kg e 168 cm cadastrados pela nutricionista (tem peso inicial): não é registro inventado.
    const real = { id: 'p-real', name: 'Davi', nutritionistId: 'nutri-1', age: 30, weight: 70, height: 168, initialWeight: 70, objective: 'Manutenção', measurements: [{ date: '2026-09-05', weight: 70, height: 168 }] };
    store.set('patients/p-real', real);
    store.set('users/p-real', { role: 'patient', patientData: { name: 'Davi', age: 55, height: 190, weight: 120, objective: 'Outro' } });
    assert.deepEqual(plain(await run("syncLegacyProfile(db, 'p-real', now)")), { changed: false });
    assert.deepEqual(store.get('patients/p-real'), real);
    assert.equal(store.get('users/p-real').profileSynced, true);
    store.set('users/p-vazio', { role: 'patient' });
    assert.deepEqual(plain(await run("syncLegacyProfile(db, 'p-vazio', now)")), { changed: false });
    assert.equal(store.has('patients/p-vazio'), false);
  });

  await check('conta antiga que nunca fez a triagem: os valores inventados saem e a triagem fica pendente', async () => {
    store.set('patients/p-pendente', { id: 'p-pendente', name: 'Edu', email: 'e@exemplo.com', nutritionistId: 'nutri-1', age: 30, weight: 70, height: 168, objective: 'Saúde Geral', measurements: [{ date: '2026-09-05', weight: 70, height: 168 }], currentPlan: null, pastPlans: [] });
    store.set('users/p-pendente', { role: 'patient', email: 'e@exemplo.com' });
    assert.deepEqual(plain(await run("syncLegacyProfile(db, 'p-pendente', now)")), { changed: true });
    const record = store.get('patients/p-pendente');
    for (const field of ['age', 'weight', 'height', 'objective']) assert.equal(field in record, false);
    assert.deepEqual(record.measurements, []);
    assert.equal(record.name, 'Edu');
    assert.equal(record.nutritionistId, 'nutri-1');
    assert.deepEqual(plain(await run("syncLegacyProfile(db, 'p-pendente', now)")), { changed: false });
  });

  // ───────────── Consultas marcadas à mão ─────────────
  store.set('users/nutri-1', { role: 'nutritionist', displayName: 'Dra. Carla Mendes', email: 'carla@exemplo.com' });
  store.set('users/nutri-2', { role: 'nutritionist', displayName: 'Dr. Paulo' });
  store.set('patients/p-semconta', { name: 'Paciente Sem Conta', nutritionistId: 'nutri-1' });
  store.set('patients/p-outra', { name: 'De Outra', nutritionistId: 'nutri-2' });
  const nutri = { uid: 'nutri-1', role: 'nutritionist' };
  const create = async (caller, input) => { context.caller = caller; context.input = input; return plain(await run('createManualAppointment(db, caller, input, now)')); };
  const list = (uid) => store.get(`users/${uid}`).appointments || [];

  await check('data e hora: precisam existir e ainda não ter passado (horário de Brasília)', async () => {
    const start = (date, time) => { context.d = date; context.t = time; return run('manualStart(d, t, now)'); };
    assert.ok(start('2026-10-12', '09:30'));
    assert.ok(start('2026-10-11', '23:30'));
    assert.equal(start('2026-10-11', '09:00'), null); // já passou hoje
    assert.equal(start('2026-02-31', '10:00'), null);
    assert.equal(start('2026-10-12', '24:00'), null);
    assert.equal(start('12/10/2026', '10:00'), null);
    assert.equal(start(null, '10:00'), null);
  });

  await check('nutricionista marca para paciente dela: aparece na lista dela e na do paciente', async () => {
    const result = await create(nutri, { patientId: 'p-clinica', date: '2026-10-14', time: '15:00', type: 'Primeira', patientName: 'nome que não vale' });
    assert.equal(result.ok, true);
    assert.equal(result.shared, true);
    assert.match(result.appointment.id, /^man_[0-9a-f]{18}$/);
    assert.equal(result.appointment.patientName, 'Caio Reis');
    assert.equal(result.appointment.createdBy, 'nutritionist');
    assert.deepEqual(list('nutri-1'), [result.appointment]);
    assert.deepEqual(list('p-clinica'), [result.appointment]);
  });

  await check('paciente de outra nutricionista não pode ser marcado; paciente sem conta fica só na lista dela', async () => {
    const other = await create(nutri, { patientId: 'p-outra', date: '2026-10-14', time: '16:00' });
    assert.equal(other.ok, false);
    assert.equal(other.status, 404);
    const noAccount = await create(nutri, { patientId: 'p-semconta', date: '2026-10-15', time: '10:00' });
    assert.equal(noAccount.shared, false);
    assert.equal(noAccount.appointment.patientUid, undefined);
    const stranger = await create(nutri, { patientName: 'Visitante', date: '2026-10-16', time: '11:00' });
    assert.equal(stranger.appointment.patientName, 'Visitante');
    assert.equal(stranger.appointment.type, 'Retorno');
    assert.equal((await create(nutri, { date: '2026-10-16', time: '11:00' })).ok, false);
    assert.equal((await create(nutri, { patientId: 'p-clinica', date: '2026-10-01', time: '11:00' })).status, 422);
    assert.equal(list('nutri-1').length, 3);
  });

  await check('paciente marca: aparece para ele e para a nutricionista dele, com o nome do prontuário', async () => {
    const result = await create({ uid: 'p-clinica', role: 'patient' }, { date: '2026-10-20', time: '09:00', patientName: 'Outro Nome', patientId: 'p-outra' });
    assert.equal(result.shared, true);
    assert.equal(result.appointment.patientName, 'Caio Reis');
    assert.equal(result.appointment.createdBy, 'patient');
    assert.equal(result.appointment.nutritionistId, 'nutri-1');
    assert.equal(list('p-clinica').length, 2);
    assert.equal(list('nutri-1').length, 4);
    // Sem nutricionista escolhida, fica só na lista do paciente.
    const alone = await create({ uid: 'p-novo', role: 'patient' }, { date: '2026-10-20', time: '09:00' });
    assert.equal(alone.shared, false);
    assert.equal(list('p-novo').length, 1);
  });

  await check('cancelar vale para as duas listas, e só quem tem a consulta consegue cancelar', async () => {
    const id = list('p-clinica')[0].id;
    const cancel = async (caller, target) => { context.caller = caller; context.id = target; return plain(await run('cancelManualAppointment(db, caller, id)')); };
    assert.equal((await cancel({ uid: 'nutri-2', role: 'nutritionist' }, id)).status, 404);
    assert.equal((await cancel({ uid: 'p-novo', role: 'patient' }, id)).status, 404);
    assert.equal(list('nutri-1').find((a) => a.id === id).status, 'Agendada');
    assert.deepEqual(await cancel({ uid: 'p-clinica', role: 'patient' }, id), { ok: true });
    assert.equal(list('p-clinica').find((a) => a.id === id).status, 'Cancelada');
    assert.equal(list('nutri-1').find((a) => a.id === id).status, 'Cancelada');
    assert.equal(list('nutri-1').filter((a) => a.status === 'Agendada').length, 3);
    // Consulta da Ali (sem a marca "manual") não é cancelada por este caminho.
    store.set('users/p-google', { ...store.get('users/p-google'), appointments: [{ id: 'evento-1', source: 'ali', status: 'Agendada' }] });
    assert.equal((await cancel({ uid: 'p-google', role: 'patient' }, 'evento-1')).status, 404);
  });

  // ───────────── Aviso de novo paciente ─────────────
  await check('paciente escolheu a nutricionista: ela recebe um e-mail, uma vez só, sem HTML do nome', async () => {
    store.set('googleConnections/nutri-1', { status: 'connected', email: 'carla@exemplo.com', refreshToken: run("encrypt(getGoogleConfig(), 'autorizacao-de-teste')") });
    store.set('patients/p-escolheu', { name: 'Lia <b>Reis</b>', email: 'lia@exemplo.com', nutritionistId: 'nutri-1' });
    assert.equal(await run("notifyNewPatient(db, 'p-escolheu')"), true);
    assert.equal(google.sent.length, 1);
    const [mail] = google.sent;
    assert.equal(mail.to, 'carla@exemplo.com');
    assert.match(mail.subject, /Novo paciente no NutriAli: Lia/);
    assert.match(mail.html, /Lia &lt;b&gt;Reis&lt;\/b&gt;/);
    assert.match(mail.html, /lia@exemplo\.com/);
    assert.equal(store.get('patients/p-escolheu').nutritionistNotifiedId, 'nutri-1');
    assert.equal(await run("notifyNewPatient(db, 'p-escolheu')"), false);
    assert.equal(google.sent.length, 1);
  });

  await check('sem Google conectado ou sem nutricionista escolhida, nenhum e-mail sai e nada quebra', async () => {
    store.set('patients/p-semgoogle', { name: 'Leo', nutritionistId: 'nutri-2' });
    assert.equal(await run("notifyNewPatient(db, 'p-semgoogle')"), false);
    assert.equal(store.get('patients/p-semgoogle').nutritionistNotifiedId, undefined);
    assert.equal(await run("notifyNewPatient(db, 'p-novo')"), false);
    assert.equal(await run("notifyNewPatient(db, 'nao-existe')"), false);
    assert.equal(google.sent.length, 1);
  });

  console.log(`${count} verificações do cadastro do paciente, das consultas manuais e do aviso de novo paciente passaram. Nenhum serviço externo foi chamado.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
