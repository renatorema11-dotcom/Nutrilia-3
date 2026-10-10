// Testa a porta de entrada da Ali da nutricionista: segredo do gateway, login, papel e confirmação.
// Firebase Admin e as ações são simulados; nenhum serviço externo é chamado.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { timingSafeEqual } = require('node:crypto');
const assert = require('node:assert/strict');

const strip = (file) => stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/^export (?=(async )?function|const|let)/gm, '');
const code = `${strip('lib/firebase-admin.ts')}\n${strip('app/api/agent/nutritionist-action/route.ts')}\nthis.POST = POST;`;
const secret = 'local-test-secret-not-for-deployment-123456';
const cfg = { projectId: 'nutri-test', firestoreDatabaseId: 'named-test-db' };
const reports = [];

async function test(name, options, status, inspect = () => {}) {
  const events = [];
  const role = options.role === undefined ? 'nutritionist' : options.role;
  const db = {
    collection: (col) => ({
      doc: (uid) => ({ get: async () => { events.push(['profile', col, uid]); return { exists: role !== null, data: () => ({ role }) }; } }),
      add: async (data) => { events.push(['audit', col, data]); },
    }),
  };
  const fixed = (label, extra = {}) => async (...args) => { events.push([label, ...args.slice(1)]); return { ok: true, speech: `${label} ok`, ...extra }; };
  const assistant = {
    listPatients: fixed('listPatients', { patients: [{ name: 'Paciente Fictício' }] }),
    patientSummary: fixed('patientSummary'),
    agenda: fixed('agenda'),
    listContacts: fixed('listContacts'),
    scheduleConsultation: fixed('scheduleConsultation'),
    cancelConsultation: fixed('cancelConsultation'),
    createEvent: fixed('createEvent'),
    sendEmail: fixed('sendEmail', { email: { to: 'Paciente Fictício', subject: 'Assunto' } }),
    ...options.assistant,
  };
  const env = { AGENT_API_SECRET: secret, FIREBASE_SERVICE_ACCOUNT_KEY: JSON.stringify({ project_id: cfg.projectId }), ...options.env };
  const context = vm.createContext({
    Buffer, Request, Response, console: { error: () => {} }, process: { env }, timingSafeEqual, firebaseConfig: cfg, assistant,
    getApps: () => [], cert: (a) => a, initializeApp: () => ({ name: 'test' }),
    getAuth: () => ({ verifyIdToken: async (token, revocation) => {
      events.push(['verify', token, revocation]);
      if (options.tokenError) throw new Error('auth/id-token-expired');
      return { uid: 'nutri-A', firebase: { sign_in_provider: options.anonymous ? 'anonymous' : 'password' } };
    } }),
    getFirestore: () => db,
  });
  vm.runInContext(code, context);
  const headers = { 'x-webhook-secret': secret, 'x-nutritionist-token': 'test-token', ...options.headers };
  Object.keys(headers).forEach((key) => { if (headers[key] === null) delete headers[key]; });
  const body = options.rawBody ?? JSON.stringify(options.body ?? { action: 'list_patients' });
  const res = await context.POST(new Request('https://unit.test/api/agent/nutritionist-action', { method: 'POST', headers, body }));
  const json = await res.json();
  assert.equal(res.status, status, name);
  assert.equal(typeof json.ok, 'boolean', name);
  assert.equal(typeof json.speech, 'string', name);
  assert.equal(res.headers.get('cache-control'), 'no-store', name);
  const acted = events.filter((e) => !['verify', 'profile', 'audit'].includes(e[0]));
  if (status !== 200 && !options.reachesAction) assert.equal(acted.length, 0, `${name}: nenhuma ação pode rodar`);
  if (status !== 200) assert.ok(!events.some((e) => e[0] === 'audit'), `${name}: sem auditoria em falha`);
  inspect(events, json, acted);
  reports.push(`PASS ${name}`);
}

(async () => {
  await test('Sem segredo do servidor: bloqueia', { env: { AGENT_API_SECRET: '' } }, 401);
  await test('Segredo de entrada ausente', { headers: { 'x-webhook-secret': null } }, 401);
  await test('Segredo incorreto', { headers: { 'x-webhook-secret': 'errado' } }, 401);
  await test('Token ausente', { headers: { 'x-nutritionist-token': null } }, 401);
  await test('Token excessivo', { headers: { 'x-nutritionist-token': 'x'.repeat(9000) } }, 401);
  await test('Admin não configurado', { env: { FIREBASE_SERVICE_ACCOUNT_KEY: '' } }, 503);
  await test('Token rejeitado pelo Firebase', { tokenError: true }, 401);
  await test('Conta anônima', { anonymous: true }, 403);
  await test('Paciente não usa a Ali da nutricionista', { role: 'patient' }, 403);
  await test('Conta sem perfil', { role: null }, 403);
  await test('JSON inválido', { rawBody: '{' }, 400);
  await test('Corpo nulo', { rawBody: 'null' }, 400);
  await test('Payload em lista', { body: { action: 'list_patients', payload: [] } }, 400);
  await test('Ação fora da lista', { body: { action: 'delete_patient' } }, 400);
  await test('Ação de paciente não vale aqui', { body: { action: 'log_meal', confirmed: true } }, 400);
  for (const action of ['schedule_consultation', 'cancel_consultation', 'create_event', 'send_email']) {
    await test(`Exige confirmação: ${action}`, { body: { action, payload: {} } }, 422);
    await test(`Confirmação em texto não vale: ${action}`, { body: { action, confirmed: 'true', payload: {} } }, 422);
  }
  await test('Lista de pacientes usa a nutricionista autenticada', {}, 200, (events, json, acted) => {
    assert.ok(events.some((e) => e[0] === 'verify' && e[2] === true));
    assert.deepEqual(acted[0].slice(0, 2), ['listPatients', 'nutri-A']);
    assert.equal(json.patients[0].name, 'Paciente Fictício');
  });
  await test('Não aceita outro uid vindo no pedido', { body: { action: 'get_patient', nutritionistId: 'nutri-B', payload: { patientName: 'Ana', nutritionistId: 'nutri-B' } } }, 200, (_, __, acted) => {
    assert.deepEqual(acted[0], ['patientSummary', 'nutri-A', 'Ana']);
  });
  await test('Agenda recebe só data e dias', { body: { action: 'get_agenda', payload: { date: '2026-10-15', days: 3, outro: 'x' } } }, 200, (_, __, acted) => {
    assert.equal(JSON.stringify(acted[0]), JSON.stringify(['agenda', 'nutri-A', { date: '2026-10-15', days: 3 }]));
  });
  await test('E-mail confirmado é enviado e auditado sem o conteúdo', { body: { action: 'send_email', confirmed: true, payload: { to: 'Ana', subject: 'Exame', body: 'Texto reservado' } } }, 200, (events, json, acted) => {
    assert.equal(acted[0][0], 'sendEmail');
    assert.equal(acted[0][2].body, 'Texto reservado');
    const audit = events.find((e) => e[0] === 'audit');
    assert.equal(audit[1], 'aiActions');
    assert.deepEqual(Object.keys(audit[2]).sort(), ['action', 'actor', 'createdAt', 'nutritionistId', 'patientUid', 'result']);
    assert.ok(!JSON.stringify(audit[2]).includes('Texto reservado'));
    assert.equal(json.email.subject, 'Assunto');
  });
  await test('Recusa da ação chega à Ali com o status certo', { reachesAction: true, assistant: { createEvent: async () => ({ ok: false, status: 409, speech: 'Você já tem um compromisso nesse horário.' }) },
    body: { action: 'create_event', confirmed: true, payload: { title: 'Reunião' } } }, 409, (_, json) => {
    assert.equal(json.speech, 'Você já tem um compromisso nesse horário.');
  });
  await test('Falha inesperada não vaza detalhes', { reachesAction: true, assistant: { listContacts: async () => { throw new Error('detalhe interno'); } }, body: { action: 'list_contacts' } }, 500, (_, json) => {
    assert.ok(!json.speech.includes('detalhe interno'));
  });
  console.log(reports.join('\n'));
  console.log(`${reports.length} testes de acesso da Ali da nutricionista passaram.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
