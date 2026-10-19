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
// A regra de "cadastro aprovado" é a de verdade (lib/nutritionist-approval.ts), não uma cópia.
const code = `${strip('lib/firebase-admin.ts')}\n${strip('lib/nutritionist-approval.ts')}\n${strip('app/api/agent/nutritionist-action/route.ts')}\nthis.POST = POST;`;
// Tabela TACO real (lib/food-info.ts) para a pergunta "quantas calorias tem…?".
const { foodInfo } = require('./fakes.cjs').loadLib(['taco-foods.ts', 'food-table.ts', 'food-info.ts'], {});
const secret = 'local-test-secret-not-for-deployment-123456';
const cfg = { projectId: 'nutri-test', firestoreDatabaseId: 'named-test-db' };
const reports = [];

async function test(name, options, status, inspect = () => {}) {
  const events = [];
  const role = options.role === undefined ? 'nutritionist' : options.role;
  const db = {
    collection: (col) => ({
      doc: (uid) => ({ get: async () => { events.push(['profile', col, uid]); return { exists: role !== null, data: () => ({ role, ...(options.approval ? { approval: options.approval } : {}) }) }; } }),
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
    rescheduleConsultation: fixed('rescheduleConsultation'),
    logMeasurement: fixed('logMeasurement', { measurement: { weight: 71.8 } }),
    sendChatMessage: fixed('sendChatMessage'),
    sendPlanToPatient: fixed('sendPlanToPatient'),
    weekSummary: fixed('weekSummary', { summary: { patients: 4 } }),
    consultationBrief: fixed('consultationBrief', { brief: { patientName: 'Ana' } }),
    attentionList: fixed('attentionList', { attention: [] }),
    listAppointmentRequests: fixed('listAppointmentRequests', { requests: [] }),
    consultationNotes: fixed('consultationNotes', { notes: [] }),
    declineAppointmentRequest: fixed('declineAppointmentRequest'),
    addConsultationNote: fixed('addConsultationNote', { note: { patientName: 'Ana' } }),
    createPlanDraft: fixed('createPlanDraft', { plan: { patientName: 'Ana', status: 'running' } }),
    planDraft: fixed('planDraft', { plan: { patientName: 'Ana', status: 'draft' } }),
    ...options.assistant,
  };
  const env = { AGENT_API_SECRET: secret, FIREBASE_SERVICE_ACCOUNT_KEY: JSON.stringify({ project_id: cfg.projectId }), ...options.env };
  const context = vm.createContext({
    Buffer, Request, Response, console: { error: () => {} }, reportServerError: () => {}, process: { env }, timingSafeEqual, firebaseConfig: cfg, assistant,
    // O rascunho do plano usa a IA (lib/plan-draft.ts) e o "after" do Next; aqui os dois são de mentira.
    generatePlanDraft: async () => ({ days: [] }), after: (task) => events.push(['after', typeof task]),
    foodInfo,
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
  // Recusas não entram no registro; a falha inesperada entra uma vez, só como 'failed', para o relatório de uso.
  const audits = events.filter((e) => e[0] === 'audit');
  if (status !== 200 && status !== 500) assert.equal(audits.length, 0, `${name}: sem auditoria em recusa`);
  if (status === 500) assert.deepEqual(audits.map((e) => e[2].result), ['failed'], `${name}: falha registrada uma vez`);
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
  await test('Nutricionista com cadastro em análise não usa a Ali', { approval: 'pending' }, 403);
  await test('Nutricionista com cadastro recusado não usa a Ali', { approval: 'rejected' }, 403);
  await test('Nutricionista aprovada usa a Ali', { approval: 'approved' }, 200);
  await test('JSON inválido', { rawBody: '{' }, 400);
  await test('Corpo nulo', { rawBody: 'null' }, 400);
  await test('Payload em lista', { body: { action: 'list_patients', payload: [] } }, 400);
  await test('Ação fora da lista', { body: { action: 'delete_patient' } }, 400);
  await test('Ação de paciente não vale aqui', { body: { action: 'log_meal', confirmed: true } }, 400);
  for (const action of ['schedule_consultation', 'reschedule_consultation', 'cancel_consultation', 'create_event', 'send_email', 'log_measurement', 'send_chat_message', 'send_plan_email', 'decline_appointment_request', 'add_consultation_note', 'create_plan_draft']) {
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
  await test('Resumo da semana é leitura: roda sem confirmação, com a busca de último acesso', { body: { action: 'get_week_summary' } }, 200, (_, json, acted) => {
    assert.deepEqual(acted[0].slice(0, 2), ['weekSummary', 'nutri-A']);
    assert.equal(typeof acted[0][2], 'function');
    assert.equal(json.summary.patients, 4);
  });
  await test('Remarcar consulta confirmada recebe paciente, dia e hora', { body: { action: 'reschedule_consultation', confirmed: true, payload: { patientName: 'Ana', date: '2026-10-22', time: '16:30' } } }, 200, (_, __, acted) => {
    assert.equal(JSON.stringify(acted[0]), JSON.stringify(['rescheduleConsultation', 'nutri-A', { patientName: 'Ana', date: '2026-10-22', time: '16:30' }]));
  });
  await test('Medição confirmada é anotada e auditada sem os números', { body: { action: 'log_measurement', confirmed: true, payload: { patientName: 'Ana', weight: 71.8 } } }, 200, (events, json, acted) => {
    assert.equal(acted[0][0], 'logMeasurement');
    assert.equal(json.measurement.weight, 71.8);
    const audit = events.find((e) => e[0] === 'audit');
    assert.equal(audit[2].action, 'log_measurement');
    assert.ok(!JSON.stringify(audit[2]).includes('71.8'));
  });
  await test('Recado no chat confirmado é enviado e auditado sem o texto', { body: { action: 'send_chat_message', confirmed: true, payload: { patientName: 'Ana', text: 'Recado reservado' } } }, 200, (events, _, acted) => {
    assert.equal(acted[0][0], 'sendChatMessage');
    assert.ok(!JSON.stringify(events.find((e) => e[0] === 'audit')[2]).includes('Recado reservado'));
  });
  await test('Plano por e-mail recebe só o nome do paciente', { body: { action: 'send_plan_email', confirmed: true, payload: { patientName: 'Ana', to: 'outra@pessoa.com' } } }, 200, (_, __, acted) => {
    assert.deepEqual(acted[0], ['sendPlanToPatient', 'nutri-A', 'Ana']);
  });
  await test('Resumo antes da consulta é leitura: recebe o nome e a busca de último acesso', { body: { action: 'get_consultation_brief', payload: { patientName: 'Ana', text: 'ignorado' } } }, 200, (_, json, acted) => {
    assert.deepEqual(acted[0].slice(0, 3), ['consultationBrief', 'nutri-A', 'Ana']);
    assert.equal(typeof acted[0][3], 'function');
    assert.equal(json.brief.patientName, 'Ana');
  });
  await test('Quem precisa de atenção é leitura e usa a busca de último acesso', { body: { action: 'get_attention_list' } }, 200, (_, __, acted) => {
    assert.deepEqual(acted[0].slice(0, 2), ['attentionList', 'nutri-A']);
    assert.equal(typeof acted[0][2], 'function');
  });
  await test('Pedidos de consulta e anotações são leituras sem confirmação', { body: { action: 'list_appointment_requests' } }, 200, (_, __, acted) => {
    assert.deepEqual(acted[0], ['listAppointmentRequests', 'nutri-A']);
  });
  await test('Ler anotações recebe só o nome do paciente', { body: { action: 'get_consultation_notes', payload: { patientName: 'Ana', nutritionistId: 'nutri-B' } } }, 200, (_, __, acted) => {
    assert.deepEqual(acted[0], ['consultationNotes', 'nutri-A', 'Ana']);
  });
  await test('Anotação confirmada é salva e auditada sem o texto', { body: { action: 'add_consultation_note', confirmed: true, payload: { patientName: 'Ana', text: 'Anotação reservada' } } }, 200, (events, json, acted) => {
    assert.equal(acted[0][0], 'addConsultationNote');
    assert.equal(acted[0][2].text, 'Anotação reservada');
    const audit = events.find((e) => e[0] === 'audit');
    assert.equal(audit[2].action, 'add_consultation_note');
    assert.ok(!JSON.stringify(audit[2]).includes('Anotação reservada'));
    assert.equal(json.note.patientName, 'Ana');
  });
  await test('Encerrar pedido de consulta confirmado chega à função certa', { body: { action: 'decline_appointment_request', confirmed: true, payload: { patientName: 'Ana', text: 'Sem horário esta semana.' } } }, 200, (_, __, acted) => {
    assert.equal(acted[0][0], 'declineAppointmentRequest');
    assert.equal(acted[0][2].patientName, 'Ana');
  });
  await test('Rascunho de plano confirmado recebe o gerador da IA e quem roda depois da resposta', { body: { action: 'create_plan_draft', confirmed: true, payload: { patientName: 'Ana', text: 'Sem lactose' } } }, 200, (events, json, acted) => {
    assert.deepEqual(acted[0].slice(0, 2), ['createPlanDraft', 'nutri-A']);
    assert.equal(acted[0][2].text, 'Sem lactose');
    assert.equal(typeof acted[0][3], 'function');
    assert.equal(typeof acted[0][4], 'function');
    acted[0][4](async () => {});
    assert.ok(events.some((e) => e[0] === 'after' && e[1] === 'function'));
    assert.equal(json.plan.status, 'running');
    assert.ok(!JSON.stringify(events.find((e) => e[0] === 'audit')[2]).includes('Sem lactose'));
  });
  await test('Calorias de um alimento: leitura pela TACO, sem chamar a assistente', { body: { action: 'food_info', payload: { food: 'arroz', grams: 150 } } }, 200, (_, json, acted) => {
    assert.match(json.speech, /^Pela tabela TACO, 150 gramas de Arroz, tipo 1, cozido têm cerca de 192 calorias/);
    assert.equal(json.food.taco, 3);
    assert.equal(acted.length, 0);
  });
  await test('Calorias de um alimento que a TACO não tem', { body: { action: 'food_info', payload: { food: 'whey' } } }, 404);
  await test('Ler o rascunho é leitura e recebe só o nome', { body: { action: 'get_plan_draft', payload: { patientName: 'Ana', text: 'x' } } }, 200, (_, __, acted) => {
    assert.deepEqual(acted[0], ['planDraft', 'nutri-A', 'Ana']);
  });
  await test('Recusa da ação chega à Ali com o status certo', { reachesAction: true, assistant: { createEvent: async () => ({ ok: false, status: 409, speech: 'Você já tem um compromisso nesse horário.' }) },
    body: { action: 'create_event', confirmed: true, payload: { title: 'Reunião' } } }, 409, (_, json) => {
    assert.equal(json.speech, 'Você já tem um compromisso nesse horário.');
  });
  await test('Falha inesperada não vaza detalhes', { reachesAction: true, assistant: { listContacts: async () => { throw new Error('detalhe interno'); } }, body: { action: 'list_contacts' } }, 500, (events, json) => {
    assert.ok(!json.speech.includes('detalhe interno'));
    const audit = events.find((e) => e[0] === 'audit');
    assert.equal(audit[2].action, 'list_contacts');
    assert.ok(!JSON.stringify(audit[2]).includes('detalhe interno'));
  });
  console.log(reports.join('\n'));
  console.log(`${reports.length} testes de acesso da Ali da nutricionista passaram.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
