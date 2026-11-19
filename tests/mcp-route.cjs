// Testa o servidor MCP do NutriAli (/api/mcp) de ponta a ponta: segredo do servidor, login da nutricionista, papel e
// aprovação, origem, versão do protocolo, ferramentas, recursos, prompts, confirmação e auditoria. O protocolo, a lista
// de ações e a rota são os de verdade; Firebase e as funções das ações são de mentira. Nenhum serviço externo é chamado.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { createHash, timingSafeEqual } = require('node:crypto');
const assert = require('node:assert/strict');

const strip = (file) => stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/^export (?=(async )?function|const|let)/gm, '');
const code = ['lib/firebase-admin.ts', 'lib/nutritionist-approval.ts', 'lib/ai-guard.ts', 'lib/mcp-protocol.ts', 'lib/nutritionist-actions.ts', 'lib/mcp-nutriali.ts', 'app/api/mcp/route.ts']
  .map(strip).join('\n') + '\nthis.POST = POST; this.GET = GET; this.NUTRITIONIST_ACTIONS = NUTRITIONIST_ACTIONS;';
const SECRET = 'segredo-do-mcp-so-para-teste-0123456789';
let count = 0;

function setup(options = {}) {
  const events = [];
  const profiles = { 'nutri-A': { role: 'nutritionist' }, 'nutri-pendente': { role: 'nutritionist', approval: 'pending' }, 'paciente-1': { role: 'patient' } };
  const db = {
    collection: (col) => ({
      doc: (id) => ({ get: async () => { if (options.profileError) throw new Error('firestore fora do ar'); return { exists: !!profiles[id], data: () => profiles[id] }; } }),
      add: async (data) => { events.push(['audit', col, data]); },
    }),
  };
  const done = (label, extra = {}) => async (...args) => { events.push([label, ...args.slice(1)]); return { ok: true, speech: `${label} ok`, ...extra }; };
  const assistant = new Proxy({
    listPatients: done('listPatients', { patients: [{ name: 'Ana' }] }),
    sendEmail: done('sendEmail', { email: { to: 'Ana' } }),
    findPatient: async (_db, uid, spoken) => { events.push(['findPatient', uid, spoken]); return { ok: true, value: { uid: 'p-ana', name: 'Ana' } }; },
    listContacts: async () => { throw new Error('detalhe interno do banco'); },
    ...options.assistant,
  }, { get: (target, fn) => target[fn] || done(String(fn)) });
  const fake = (label) => new Proxy({}, { get: (_, fn) => done(`${label}.${String(fn)}`) });
  const context = vm.createContext({
    Buffer, Request, Response, URL, Map, Set, Promise, JSON, Date, Intl, decodeURIComponent, console: { error: () => {} },
    createHash, timingSafeEqual, reportServerError: (message) => events.push(['alert', message]),
    process: { env: { MCP_SERVER_SECRET: SECRET, FIREBASE_SERVICE_ACCOUNT_KEY: JSON.stringify({ project_id: 'nutri-test' }), ...options.env } },
    firebaseConfig: { projectId: 'nutri-test', firestoreDatabaseId: '(default)' },
    getApps: () => [], cert: (a) => a, initializeApp: () => ({ name: 'test' }), getFirestore: () => db,
    getAuth: () => ({ verifyIdToken: async (token) => {
      if (token === 'token-ruim') throw new Error('auth/argument-error');
      return { uid: token.replace('token-', ''), firebase: { sign_in_provider: token === 'token-anonimo' ? 'anonymous' : 'password' } };
    } }),
    after: (task) => events.push(['after', typeof task]), generatePlanDraft: async () => ({ days: [] }),
    assistant, memory: fake('memory'), clinical: fake('clinical'), timeline: fake('timeline'), brain: fake('brain'), foods: fake('foods'),
    foodInfo: (food, grams) => { events.push(['foodInfo', food, grams]); return { ok: true, speech: 'Pela tabela TACO, ...' }; },
    loadSettings: async () => ({ timezone: 'America/Sao_Paulo' }), localDateKey: () => '2026-11-17',
  });
  vm.runInContext(code, context);
  const call = async (body, headers = {}) => {
    const all = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${SECRET}`, 'x-nutritionist-token': 'token-nutri-A', ...headers };
    Object.keys(all).forEach((key) => { if (all[key] === null) delete all[key]; });
    const res = await context.POST(new Request('https://app.nutriali.cloud/api/mcp', { method: 'POST', headers: all, body: typeof body === 'string' ? body : JSON.stringify(body) }));
    const text = await res.text();
    return { status: res.status, res, json: text ? JSON.parse(text) : null };
  };
  const rpc = (method, params, headers) => call({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }, headers);
  const acted = () => events.filter((e) => !['audit', 'alert', 'after'].includes(e[0]));
  return { context, events, call, rpc, acted };
}

async function check(name, fn) { await fn(); count++; }

(async () => {
  await check('sem MCP_SERVER_SECRET o servidor fica desligado', async () => {
    const t = setup({ env: { MCP_SERVER_SECRET: '' } });
    assert.equal((await t.rpc('tools/list')).status, 503);
  });

  await check('segredo errado ou ausente: 401, e nada roda', async () => {
    const t = setup();
    assert.equal((await t.rpc('tools/list', null, { authorization: 'Bearer outro' })).status, 401);
    assert.equal((await t.rpc('tools/list', null, { authorization: null })).status, 401);
    assert.equal(t.acted().length, 0);
  });

  await check('o segredo vale no Authorization ou no x-mcp-secret', async () => {
    const t = setup();
    assert.equal((await t.rpc('ping', null, { authorization: null, 'x-mcp-secret': SECRET })).status, 200);
    assert.equal((await t.rpc('ping', null, { authorization: SECRET })).status, 200);
    assert.equal((await t.rpc('ping', null, { authorization: `bearer ${SECRET}` })).status, 200);
    assert.deepEqual((await t.rpc('ping')).json.result, {});
  });

  await check('origem de outro site é recusada; a do app passa', async () => {
    const t = setup();
    assert.equal((await t.rpc('ping', null, { origin: 'https://site-malicioso.exemplo' })).status, 403);
    assert.equal((await t.rpc('ping', null, { origin: 'https://app.nutriali.cloud' })).status, 200);
  });

  await check('versão do protocolo que não existe é recusada', async () => {
    const t = setup();
    assert.equal((await t.rpc('ping', null, { 'mcp-protocol-version': '1999-01-01' })).status, 400);
    assert.equal((await t.rpc('ping', null, { 'mcp-protocol-version': '2025-06-18' })).status, 200);
  });

  await check('initialize apresenta o servidor e as regras', async () => {
    const t = setup();
    const { json } = await t.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'teste', version: '1' } }, { 'x-nutritionist-token': null });
    assert.equal(json.result.protocolVersion, '2025-06-18');
    assert.equal(json.result.serverInfo.name, 'nutriali');
    assert.match(json.result.instructions, /confirmed=true/);
    assert.match(json.result.instructions, /não prescreve/);
  });

  await check('lista de ferramentas: todas as ações, leitura marcada, e escrita exige confirmed', async () => {
    const t = setup();
    const { json } = await t.rpc('tools/list', null, { 'x-nutritionist-token': null });
    const tools = json.result.tools;
    assert.equal(tools.length, t.context.NUTRITIONIST_ACTIONS.length);
    for (const name of ['list_patients', 'get_patient', 'get_agenda', 'schedule_consultation', 'send_email', 'create_plan_draft', 'create_spreadsheet', 'food_info',
      'get_clinical_profile', 'update_clinical_profile', 'get_patient_timeline', 'check_plan', 'remember_preference', 'add_followup', 'search_records', 'calculate_energy_needs', 'food_nutrients']) {
      assert.ok(tools.some((tool) => tool.name === name), name);
    }
    const send = tools.find((tool) => tool.name === 'send_email');
    assert.equal(send.annotations.readOnlyHint, false);
    assert.equal(send.annotations.openWorldHint, true);
    assert.ok(send.inputSchema.required.includes('confirmed'));
    const list = tools.find((tool) => tool.name === 'list_patients');
    assert.equal(list.annotations.readOnlyHint, true);
    assert.equal(list.inputSchema.properties.confirmed, undefined);
    assert.equal(tools.find((tool) => tool.name === 'cancel_consultation').annotations.destructiveHint, true);
    // Tirar alergia da ficha, trocar rascunho e remarcar mudam o que existe: destrutivas. Anotar peso só acrescenta.
    for (const name of ['update_clinical_profile', 'create_plan_draft', 'reschedule_consultation', 'complete_followup']) assert.equal(tools.find((tool) => tool.name === name).annotations.destructiveHint, true, name);
    for (const name of ['log_measurement', 'add_followup', 'list_patients']) assert.equal(tools.find((tool) => tool.name === name).annotations.destructiveHint, false, name);
    // Toda descrição cabe em pouco texto: a lista vai para o modelo em toda conversa.
    for (const tool of tools) assert.ok(tool.description.length <= 400, `${tool.name}: descrição longa demais`);
  });

  await check('sem o login da nutricionista: lista, mas não executa nem lê', async () => {
    const t = setup();
    const called = await t.rpc('tools/call', { name: 'list_patients', arguments: {} }, { 'x-nutritionist-token': null });
    assert.equal(called.json.result.isError, true);
    assert.match(called.json.result.content[0].text, /Entre/);
    assert.equal((await t.rpc('resources/read', { uri: 'nutriali://pacientes' }, { 'x-nutritionist-token': null })).json.error.code, -32001);
    assert.equal(t.acted().length, 0);
  });

  await check('login inválido, anônimo, de paciente ou de nutricionista em análise não executa', async () => {
    for (const token of ['token-ruim', 'token-anonimo', 'token-paciente-1', 'token-nutri-pendente']) {
      const t = setup();
      const { json } = await t.rpc('tools/call', { name: 'list_patients', arguments: {} }, { 'x-nutritionist-token': token });
      assert.equal(json.result.isError, true, token);
      assert.equal(t.acted().length, 0, token);
    }
  });

  await check('leitura roda com o uid do login, nunca com o que vem nos argumentos, e é auditada sem conteúdo', async () => {
    const t = setup();
    const { json } = await t.rpc('tools/call', { name: 'list_patients', arguments: { search: 'Ana', nutritionistId: 'nutri-B' } });
    assert.equal(json.result.isError, false);
    assert.equal(json.result.content[0].text, 'listPatients ok');
    assert.equal(json.result.structuredContent.patients[0].name, 'Ana');
    assert.deepEqual(t.acted()[0], ['listPatients', 'nutri-A', 'Ana']);
    const audit = t.events.find((e) => e[0] === 'audit');
    assert.equal(audit[1], 'aiActions');
    assert.equal(audit[2].nutritionistId, 'nutri-A');
    assert.equal(audit[2].channel, 'mcp');
    assert.equal(audit[2].action, 'list_patients');
    assert.ok(!JSON.stringify(audit[2]).includes('Ana'));
  });

  await check('escrita sem confirmed (ou com "true" em texto) não roda e não entra na auditoria', async () => {
    const t = setup();
    for (const confirmed of [undefined, 'true', false]) {
      const { json } = await t.rpc('tools/call', { name: 'send_email', arguments: { to: 'Ana', subject: 'Oi', body: 'Texto', ...(confirmed === undefined ? {} : { confirmed }) } });
      assert.equal(json.result.isError, true);
      assert.match(json.result.content[0].text, /Confirme/);
    }
    assert.equal(t.acted().length, 0);
    assert.equal(t.events.filter((e) => e[0] === 'audit').length, 0);
  });

  await check('escrita confirmada roda, sem o confirmed no pedido, e a auditoria não leva o texto', async () => {
    const t = setup();
    const { json } = await t.rpc('tools/call', { name: 'send_email', arguments: { to: 'Ana', subject: 'Exame', body: 'Texto reservado', confirmed: true } });
    assert.equal(json.result.isError, false);
    const [label, uid, payload] = t.acted()[0];
    assert.equal(label, 'sendEmail');
    assert.equal(uid, 'nutri-A');
    assert.equal(JSON.stringify(payload), JSON.stringify({ to: 'Ana', subject: 'Exame', body: 'Texto reservado' }));
    assert.ok(!JSON.stringify(t.events.find((e) => e[0] === 'audit')[2]).includes('Texto reservado'));
  });

  await check('rascunho de plano roda depois da resposta, como no webhook', async () => {
    const t = setup();
    await t.rpc('tools/call', { name: 'create_plan_draft', arguments: { patientName: 'Ana', confirmed: true } });
    const [label, uid, , generate, later] = t.acted()[0];
    assert.equal(label, 'createPlanDraft');
    assert.equal(uid, 'nutri-A');
    assert.equal(typeof generate, 'function');
    later(async () => {});
    assert.ok(t.events.some((e) => e[0] === 'after'));
  });

  await check('ferramenta que não existe: erro do protocolo', async () => {
    const t = setup();
    const { json } = await t.rpc('tools/call', { name: 'delete_everything', arguments: {} });
    assert.equal(json.error.code, -32602);
    assert.equal(t.acted().length, 0);
  });

  await check('falha inesperada não vaza detalhes, avisa o servidor e entra como failed', async () => {
    const t = setup();
    const { status, json } = await t.rpc('tools/call', { name: 'list_contacts', arguments: {} });
    assert.equal(status, 200);
    assert.equal(json.result.isError, true);
    assert.ok(!JSON.stringify(json).includes('detalhe interno'));
    assert.deepEqual(t.events.filter((e) => e[0] === 'audit').map((e) => e[2].result), ['failed']);
    assert.ok(t.events.some((e) => e[0] === 'alert'));
  });

  await check('recursos: lista, leitura de paciente pelo nome e endereço que não existe', async () => {
    const t = setup();
    const list = (await t.rpc('resources/list')).json.result.resources;
    assert.ok(list.some((r) => r.uri === 'nutriali://pacientes'));
    assert.ok((await t.rpc('resources/templates/list')).json.result.resourceTemplates.some((r) => r.uriTemplate === 'nutriali://paciente/{nome}/ficha'));
    const read = (await t.rpc('resources/read', { uri: 'nutriali://paciente/Ana%20Souza/ficha' })).json.result.contents[0];
    assert.equal(read.mimeType, 'application/json');
    assert.equal(JSON.parse(read.text).speech, 'clinical.getClinicalProfile ok');
    assert.deepEqual(t.acted()[0], ['findPatient', 'nutri-A', 'Ana Souza']);
    assert.equal((await t.rpc('resources/read', { uri: 'nutriali://outra-coisa' })).json.error.code, -32002);
  });

  await check('prompts: roteiro com o nome do paciente; falta de argumento obrigatório é erro', async () => {
    const t = setup();
    assert.ok((await t.rpc('prompts/list')).json.result.prompts.some((p) => p.name === 'preparar_dia'));
    const got = (await t.rpc('prompts/get', { name: 'preparar_consulta', arguments: { paciente: 'Ana Souza' } })).json.result;
    assert.match(got.messages[0].content.text, /Ana Souza/);
    assert.match(got.messages[0].content.text, /get_clinical_profile/);
    assert.equal((await t.rpc('prompts/get', { name: 'revisar_rascunho_de_plano', arguments: {} })).json.error.code, -32602);
    assert.equal((await t.rpc('prompts/get', { name: 'nao_existe' })).json.error.code, -32602);
    assert.equal(t.acted().length, 0);
  });

  await check('banco fora do ar: a conexão continua, e a ferramenta pede para tentar de novo sem rodar nada', async () => {
    const t = setup({ profileError: true });
    const init = await t.rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'x', version: '1' } });
    assert.equal(init.status, 200);
    assert.equal((await t.rpc('tools/list')).status, 200);
    const called = (await t.rpc('tools/call', { name: 'list_patients', arguments: {} })).json.result;
    assert.equal(called.isError, true);
    assert.match(called.content[0].text, /Tente de novo/);
    assert.equal(t.acted().length, 0);
  });

  await check('limite por chamada de ferramenta: passou de 120 em 10 minutos, para de executar', async () => {
    const t = setup();
    let refused = 0;
    for (let i = 0; i < 121; i++) {
      const { json } = await t.rpc('tools/call', { name: 'food_info', arguments: { food: 'arroz' } });
      if (json.result.isError) refused++;
    }
    assert.equal(refused, 1);
    assert.equal(t.events.filter((e) => e[0] === 'foodInfo').length, 120);
  });

  await check('JSON inválido, corpo grande demais, notificação e GET', async () => {
    const t = setup();
    const bad = await t.call('{');
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, -32700);
    assert.equal((await t.call(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { x: 'a'.repeat(70_000) } }))).status, 413);
    const note = await t.call({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(note.status, 202);
    assert.equal(note.json, null);
    assert.equal(t.context.GET().status, 405);
  });

  console.log(`${count} verificações do servidor MCP passaram. Nenhum serviço externo foi chamado.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
