// Testa o protocolo MCP da Ali das nutricionistas (lib/mcp-protocol.ts): JSON-RPC 2.0, versões, avisos, lotes,
// ferramentas, recursos, prompts e o que acontece sem a nutricionista logada. O host é simulado; nada externo é chamado.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { loadLib } = require('./fakes.cjs');

const context = loadLib(['mcp-protocol.ts'], {});
const run = (code) => vm.runInContext(code, context);
const plain = (value) => JSON.parse(JSON.stringify(value));
const handleMcpPayload = run('handleMcpPayload');
const VERSIONS = plain(run('MCP_PROTOCOL_VERSIONS'));
const ERRORS = plain(run('MCP_ERRORS'));

let count = 0;
async function check(name, fn) { await fn(); count++; }

const SECRET = 'detalhe-interno-que-nao-pode-vazar';

/** Host de mentira: guarda as chamadas para o teste conferir o que chegou e o que não chegou. */
function makeHost(overrides = {}) {
  const calls = { tools: [], resources: [], prompts: [] };
  const host = {
    serverInfo: { name: 'nutriali-ali', title: 'Ali do NutriAli', version: '2.1.0', segredo: SECRET },
    instructions: 'Você é a Ali, assistente da nutricionista. A decisão é sempre dela.',
    authenticated: true,
    tools: [
      { name: 'list_patients', title: 'Listar pacientes', description: 'Lista os pacientes.', inputSchema: { type: 'object', properties: { search: { type: 'string' } } }, readOnly: true, handler: SECRET },
      { name: 'add_followup', title: 'Anotar pendência', description: 'Anota uma pendência.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] }, readOnly: false },
      { name: 'remove_memory', title: 'Apagar item da memória', description: 'Apaga.', inputSchema: { type: 'object' }, readOnly: false, destructive: true, idempotent: true, openWorld: false },
      { name: 'send_email', title: 'Enviar e-mail', description: 'Envia.', inputSchema: { type: 'object' }, readOnly: false, destructive: false, openWorld: true },
      { name: 'broken_tool', title: 'Quebrada', description: 'Sempre falha.', inputSchema: null, readOnly: true },
    ],
    callTool: async (name, args) => {
      calls.tools.push({ name, args });
      if (name === 'broken_tool') throw new Error(SECRET);
      if (name === 'add_followup' && !args.text) return { ok: false, speech: 'O que eu anoto?' };
      if (name === 'add_followup') return { ok: true, speech: `Anotado: ${args.text}.`, data: { followup: { id: 'f1', text: args.text }, ok: 'falso', speech: 'outra', skip: undefined, fn: () => 1 } };
      return { ok: true, speech: 'Você tem 2 pacientes: Ana e João.', data: { patients: [{ name: 'Ana' }, { name: 'João' }] } };
    },
    resources: [{ uri: 'nutriali://memoria/preferencias', name: 'preferencias', title: 'Preferências', description: 'Jeito de trabalhar.', mimeType: 'text/plain', extra: SECRET }],
    resourceTemplates: [{ uriTemplate: 'nutriali://pacientes/{nome}/ficha', name: 'ficha', title: 'Ficha clínica', description: 'Ficha de um paciente.', mimeType: 'application/json', extra: SECRET }],
    readResource: async (uri) => {
      calls.resources.push(uri);
      if (uri === 'nutriali://quebrado') throw new Error(SECRET);
      if (uri === 'nutriali://memoria/preferencias') return { mimeType: 'text/plain', text: '1) Plano sem glúten; 2) Fala curta.' };
      if (uri === 'nutriali://sem-tipo') return { text: 'sem mimeType' };
      return null;
    },
    prompts: [
      { name: 'preparar_consulta', title: 'Preparar consulta', description: 'Resumo antes da consulta.', arguments: [{ name: 'paciente', description: 'Nome do paciente', required: true, extra: SECRET }] },
      { name: 'semana', title: 'Resumo da semana', description: 'A semana.', arguments: undefined },
      { name: 'quebrado', title: 'Quebrado', description: 'Falha.', arguments: [] },
    ],
    getPrompt: async (name, args) => {
      calls.prompts.push({ name, args });
      if (name === 'quebrado') throw new Error(SECRET);
      if (name === 'semana') return null;
      if (!args.paciente) return 'Diga o nome do paciente.';
      return { description: `Preparar a consulta de ${args.paciente}`, text: `Prepare a consulta de ${args.paciente} (${args.minutos || 'sem tempo'}).` };
    },
    ...overrides,
  };
  return { host, calls };
}

/** Chama o protocolo e devolve status e corpo como JSON puro (o resultado vem de outro contexto do vm). */
async function send(payload, host = makeHost().host) {
  const out = await handleMcpPayload(payload, host);
  return plain({ status: out.status, body: out.body });
}
const request = (method, params, id = 1) => (params === undefined ? { jsonrpc: '2.0', id, method } : { jsonrpc: '2.0', id, method, params });
const errorOf = async (payload, host) => { const out = await send(payload, host); assert.equal(out.status, 200, JSON.stringify(out)); assert.ok(out.body.error, JSON.stringify(out)); return out.body.error; };
const resultOf = async (payload, host) => { const out = await send(payload, host); assert.equal(out.status, 200, JSON.stringify(out)); assert.ok(out.body.result, JSON.stringify(out)); return out.body.result; };

(async () => {
  await check('o arquivo é puro: sem importações, sem banco, sem rede e sem variáveis de ambiente', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'mcp-protocol.ts'), 'utf8');
    assert.ok(!/^import /m.test(source));
    for (const word of ['process.env', 'fetch(', 'firebase', 'Firestore', 'db.collection']) assert.ok(!source.includes(word), word);
    assert.deepEqual(VERSIONS, ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']);
    assert.deepEqual(ERRORS, { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603, unauthorized: -32001, resourceNotFound: -32002 });
  });

  await check('JSON inválido: 400 com erro -32700 e id null', async () => {
    assert.deepEqual(await send(undefined), { status: 400, body: { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } } });
  });

  await check('envelope inválido: 400 com -32600 (id null quando o id não serve)', async () => {
    const bad = [null, 42, 'ping', true, {}, { jsonrpc: '1.0', id: 1, method: 'ping' }, { id: 1, method: 'ping' },
      { jsonrpc: '2.0', id: 1, method: 7 }, { jsonrpc: '2.0', method: ['ping'] }, { jsonrpc: '2.0', id: null, method: 'ping' },
      { jsonrpc: '2.0', id: { a: 1 }, method: 'ping' }, { jsonrpc: '2.0', id: 1.5, method: 'ping' }, { jsonrpc: '2.0', id: true, method: 'ping' },
      { jsonrpc: '2.0', id: 'x'.repeat(201), method: 'ping' }, { jsonrpc: '2.0', id: 3, method: 'ping', params: 'texto' },
      { jsonrpc: '2.0', id: 3, method: 'ping', params: 5 }, { jsonrpc: '2.0', id: 4 }, { jsonrpc: '2.0', id: [1], result: {} }];
    for (const payload of bad) {
      const out = await send(payload);
      assert.equal(out.status, 400, JSON.stringify(payload));
      assert.equal(out.body.jsonrpc, '2.0');
      assert.equal(out.body.error.code, -32600, JSON.stringify(payload));
      assert.ok(!('result' in out.body));
    }
    // O id é devolvido quando dá para reconhecê-lo; senão vai null, como pede o JSON-RPC.
    assert.equal((await send({ id: 1, method: 'ping' })).body.id, 1);
    assert.equal((await send({ jsonrpc: '2.0', id: 3, method: 'ping', params: 'texto' })).body.id, 3);
    assert.equal((await send({ jsonrpc: '2.0', id: null, method: 'ping' })).body.id, null);
    assert.equal((await send({ jsonrpc: '2.0', id: 'x'.repeat(201), method: 'ping' })).body.id, null);
  });

  await check('tipos de id: texto (até vazio) e inteiro (até zero e negativo) voltam iguais', async () => {
    for (const id of ['abc-123', '', 0, 7, -2, 9007199254740991]) {
      assert.deepEqual(await send(request('ping', undefined, id)), { status: 200, body: { jsonrpc: '2.0', id, result: {} } });
    }
    // params null conta como sem params; params lista (posicional) é parâmetro inválido.
    assert.deepEqual((await send(request('ping', null))).body.result, {});
    assert.deepEqual(await send(request('ping', [1, 2])), { status: 200, body: { jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Invalid params' } } });
  });

  await check('avisos e respostas do cliente: 202 sem corpo, e nada é executado', async () => {
    const { host, calls } = makeHost();
    for (const payload of [
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1, reason: 'cancelado' } },
      { jsonrpc: '2.0', method: 'tools/call', params: { name: 'add_followup', arguments: { text: 'aviso não executa' } } },
      { jsonrpc: '2.0', method: 'qualquer/coisa', params: 'até params estranho' },
      { jsonrpc: '2.0', id: 5, result: {} },
      { jsonrpc: '2.0', id: 'r1', error: { code: -1, message: 'recusado' } },
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
    ]) {
      assert.deepEqual(await send(payload, host), { status: 202, body: null }, JSON.stringify(payload));
    }
    assert.equal(calls.tools.length, 0);
  });

  await check('initialize: negocia a versão, anuncia só o que existe e não vaza campos extras do host', async () => {
    for (const version of VERSIONS) {
      const result = await resultOf(request('initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'cliente', version: '1' } }));
      assert.equal(result.protocolVersion, version);
    }
    for (const params of [{ protocolVersion: '2099-01-01' }, { protocolVersion: 20250618 }, {}, undefined]) {
      assert.equal((await resultOf(request('initialize', params))).protocolVersion, '2025-11-25', JSON.stringify(params));
    }
    const result = await resultOf(request('initialize', { protocolVersion: '2025-06-18' }, 'init'));
    assert.deepEqual(result, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false }, prompts: { listChanged: false } },
      serverInfo: { name: 'nutriali-ali', title: 'Ali do NutriAli', version: '2.1.0' },
      instructions: 'Você é a Ali, assistente da nutricionista. A decisão é sempre dela.',
    });
    // Sem instruções, o campo nem vai; e o initialize funciona mesmo sem a nutricionista logada.
    const quiet = await resultOf(request('initialize', {}), makeHost({ instructions: '', authenticated: false }).host);
    assert.ok(!('instructions' in quiet));
  });

  await check('ping responde objeto vazio', async () => {
    assert.deepEqual(await send(request('ping', {}, 'p')), { status: 200, body: { jsonrpc: '2.0', id: 'p', result: {} } });
  });

  await check('tools/list: campos do protocolo, dicas de leitura/exclusão e nada interno', async () => {
    const result = await resultOf(request('tools/list', { cursor: 'qualquer' }));
    assert.ok(!('nextCursor' in result));
    assert.deepEqual(result.tools.map((t) => t.name), ['list_patients', 'add_followup', 'remove_memory', 'send_email', 'broken_tool']);
    assert.deepEqual(result.tools[0], {
      name: 'list_patients', title: 'Listar pacientes', description: 'Lista os pacientes.',
      inputSchema: { type: 'object', properties: { search: { type: 'string' } } },
      annotations: { title: 'Listar pacientes', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    });
    // Ferramenta que grava sem dizer nada conta como destrutiva (padrão do MCP); o que o host disser vale.
    assert.deepEqual(result.tools[1].annotations, { title: 'Anotar pendência', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false });
    assert.deepEqual(result.tools[2].annotations, { title: 'Apagar item da memória', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false });
    assert.deepEqual(result.tools[3].annotations, { title: 'Enviar e-mail', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
    assert.deepEqual(result.tools[4].inputSchema, { type: 'object' });
    assert.ok(!JSON.stringify(result).includes(SECRET));
    // Listar não precisa da nutricionista logada.
    assert.equal((await resultOf(request('tools/list'), makeHost({ authenticated: false }).host)).tools.length, 5);
    // Host sem lista (engano da rota) não derruba: lista vazia.
    assert.deepEqual((await resultOf(request('tools/list'), makeHost({ tools: undefined }).host)).tools, []);
  });

  await check('tools/call: fala da Ali no texto, dados estruturados e isError conforme o resultado', async () => {
    const { host, calls } = makeHost();
    const listed = await resultOf(request('tools/call', { name: 'list_patients', arguments: { search: 'ana' } }), host);
    assert.deepEqual(listed, {
      // A fala primeiro; os mesmos dados em JSON num segundo bloco, para clientes que não leem structuredContent.
      content: [{ type: 'text', text: 'Você tem 2 pacientes: Ana e João.' }, { type: 'text', text: JSON.stringify({ ok: true, speech: 'Você tem 2 pacientes: Ana e João.', patients: [{ name: 'Ana' }, { name: 'João' }] }) }],
      structuredContent: { ok: true, speech: 'Você tem 2 pacientes: Ana e João.', patients: [{ name: 'Ana' }, { name: 'João' }] },
      isError: false,
    });
    assert.deepEqual(plain(calls.tools[0]), { name: 'list_patients', args: { search: 'ana' } });
    // ok e speech dos dados não substituem os do resultado; o que não é JSON fica de fora.
    const added = await resultOf(request('tools/call', { name: 'add_followup', arguments: { text: 'Pedir exames da Ana' } }), host);
    assert.deepEqual(added.structuredContent, { ok: true, speech: 'Anotado: Pedir exames da Ana.', followup: { id: 'f1', text: 'Pedir exames da Ana' } });
    // Erro que a nutricionista resolve: vai como resultado com isError, para a IA perguntar de novo.
    const missing = await resultOf(request('tools/call', { name: 'add_followup' }), host);
    assert.deepEqual(missing, { content: [{ type: 'text', text: 'O que eu anoto?' }], structuredContent: { ok: false, speech: 'O que eu anoto?' }, isError: true });
    // Sem arguments chega objeto vazio; null também.
    assert.deepEqual(plain(calls.tools[2].args), {});
    await resultOf(request('tools/call', { name: 'list_patients', arguments: null }), host);
    assert.deepEqual(plain(calls.tools[3].args), {});
  });

  await check('tools/call: argumentos com __proto__ não mexem em protótipos e chegam sem essa chave', async () => {
    const { host, calls } = makeHost();
    const payload = JSON.parse('{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"list_patients","arguments":{"__proto__":{"admin":true},"search":"jo"}}}');
    await resultOf(payload, host);
    const args = calls.tools[0].args;
    assert.equal(args.admin, undefined);
    assert.equal(Object.getPrototypeOf(args), Object.getPrototypeOf(run('({})')));
    assert.deepEqual(Object.keys(args), ['search']);
    assert.equal({}.admin, undefined);
  });

  await check('tools/call: ferramenta desconhecida, nome ruim e arguments que não é objeto viram -32602', async () => {
    const { host, calls } = makeHost();
    assert.deepEqual(await errorOf(request('tools/call', { name: 'apagar_tudo' }), host), { code: -32602, message: 'Unknown tool: apagar_tudo' });
    // Nome gigante: nem é procurado, e o erro cita no máximo 200 caracteres (sem caracteres de controle).
    const huge = await errorOf(request('tools/call', { name: '\u0000ab' + 'x'.repeat(5000) }), host);
    assert.equal(huge.code, -32602);
    assert.ok(huge.message.length <= 'Unknown tool: '.length + 200);
    assert.ok(!huge.message.includes('\u0000'));
    for (const name of [undefined, '', 42, { a: 1 }]) assert.equal((await errorOf(request('tools/call', { name }), host)).code, -32602, String(name));
    for (const args of [[1, 2], 'texto', 3, true]) {
      assert.deepEqual(await errorOf(request('tools/call', { name: 'list_patients', arguments: args }), host), { code: -32602, message: 'Invalid params: arguments must be an object' });
    }
    assert.equal(calls.tools.length, 0);
  });

  await check('tools/call sem a nutricionista logada: nada é executado e a IA recebe um aviso em português', async () => {
    const { host, calls } = makeHost({ authenticated: false });
    const result = await resultOf(request('tools/call', { name: 'add_followup', arguments: { text: 'Não pode gravar' } }), host);
    assert.equal(result.isError, true);
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, 'text');
    assert.match(result.content[0].text, /^Sua sessão no NutriAli expirou ou não foi confirmada\. Entre novamente/);
    assert.equal(calls.tools.length, 0);
    // Qualquer valor que não seja exatamente true conta como não logada.
    const { host: odd, calls: oddCalls } = makeHost({ authenticated: 'sim' });
    assert.equal((await resultOf(request('tools/call', { name: 'list_patients' }), odd)).isError, true);
    assert.equal(oddCalls.tools.length, 0);
    // A ferramenta desconhecida continua sendo erro de protocolo, logada ou não.
    assert.equal((await errorOf(request('tools/call', { name: 'nao_existe' }), host)).code, -32602);
  });

  await check('tools/call: erro lançado pela ferramenta não vaza o texto da exceção', async () => {
    const out = await send(request('tools/call', { name: 'broken_tool', arguments: {} }));
    assert.equal(out.status, 200);
    assert.deepEqual(out.body.result, { content: [{ type: 'text', text: 'Não consegui fazer isso agora. Tente de novo em instantes.' }], isError: true });
    assert.ok(!JSON.stringify(out).includes(SECRET));
  });

  await check('tools/call: resultado estranho do host (vazio, sem fala, dados que não são objeto)', async () => {
    const outcomes = [undefined, null, 'texto', { ok: true, speech: '   ' }, { ok: 'true', speech: 'Feito.' }, { ok: true, speech: 'Feito.', data: [1, 2] }, { ok: true, speech: 'Circular.', data: (() => { const d = {}; d.self = d; return d; })() }];
    const expected = [
      ['Não consegui fazer isso agora. Tente de novo em instantes.', true], ['Não consegui fazer isso agora. Tente de novo em instantes.', true],
      ['Não consegui fazer isso agora. Tente de novo em instantes.', true], ['Pronto.', false], ['Feito.', true], ['Feito.', false], ['Circular.', false],
    ];
    for (const [i, outcome] of outcomes.entries()) {
      const host = makeHost({ callTool: async () => outcome }).host;
      const result = await resultOf(request('tools/call', { name: 'list_patients' }), host);
      assert.deepEqual([result.content[0].text, result.isError], expected[i], String(i));
      assert.deepEqual(Object.keys(result.structuredContent), ['ok', 'speech'], String(i));
    }
    context.outcome = { ok: true, speech: ' Pronto, anotei. ' };
    assert.equal(run('mcpToolResultText(outcome)'), 'Pronto, anotei.');
    assert.equal(run('mcpToolResultText(null)'), 'Não consegui fazer isso agora. Tente de novo em instantes.');
  });

  await check('resources/list e resources/templates/list: só os campos do protocolo', async () => {
    assert.deepEqual((await resultOf(request('resources/list', { cursor: 'x' }))).resources, [
      { uri: 'nutriali://memoria/preferencias', name: 'preferencias', title: 'Preferências', description: 'Jeito de trabalhar.', mimeType: 'text/plain' },
    ]);
    assert.deepEqual((await resultOf(request('resources/templates/list'))).resourceTemplates, [
      { uriTemplate: 'nutriali://pacientes/{nome}/ficha', name: 'ficha', title: 'Ficha clínica', description: 'Ficha de um paciente.', mimeType: 'application/json' },
    ]);
    // Listar não precisa da nutricionista logada.
    assert.equal((await resultOf(request('resources/list'), makeHost({ authenticated: false }).host)).resources.length, 1);
  });

  await check('resources/read: conteúdo, não encontrado (-32002), sem login (-32001) e erro interno sem vazar', async () => {
    const { host, calls } = makeHost();
    assert.deepEqual(await resultOf(request('resources/read', { uri: 'nutriali://memoria/preferencias' }), host), {
      contents: [{ uri: 'nutriali://memoria/preferencias', mimeType: 'text/plain', text: '1) Plano sem glúten; 2) Fala curta.' }],
    });
    assert.equal((await resultOf(request('resources/read', { uri: 'nutriali://sem-tipo' }), host)).contents[0].mimeType, 'text/plain');
    assert.deepEqual(await errorOf(request('resources/read', { uri: 'nutriali://nao-existe' }), host), { code: -32002, message: 'Resource not found', data: { uri: 'nutriali://nao-existe' } });
    // Uri gigante: o host nem é chamado e o erro devolve no máximo 200 caracteres.
    const before = calls.resources.length;
    const huge = await errorOf(request('resources/read', { uri: 'nutriali://' + 'a'.repeat(3000) }), host);
    assert.equal(huge.code, -32002);
    assert.equal(huge.data.uri.length, 200);
    assert.equal(calls.resources.length, before);
    for (const uri of [undefined, '', 12, ['a']]) assert.equal((await errorOf(request('resources/read', { uri }), host)).code, -32602, String(uri));
    const broken = await send(request('resources/read', { uri: 'nutriali://quebrado' }), host);
    assert.deepEqual(broken, { status: 200, body: { jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Internal error' } } });
    // Sem a nutricionista: -32001 e o host não lê nada.
    const { host: anon, calls: anonCalls } = makeHost({ authenticated: false });
    const denied = await errorOf(request('resources/read', { uri: 'nutriali://memoria/preferencias' }), anon);
    assert.equal(denied.code, -32001);
    assert.match(denied.message, /Entre novamente/);
    assert.equal(anonCalls.resources.length, 0);
  });

  await check('prompts/list e prompts/get: mensagens, argumentos e erros -32602', async () => {
    const { host, calls } = makeHost();
    assert.deepEqual((await resultOf(request('prompts/list'), host)).prompts, [
      { name: 'preparar_consulta', title: 'Preparar consulta', description: 'Resumo antes da consulta.', arguments: [{ name: 'paciente', description: 'Nome do paciente', required: true }] },
      { name: 'semana', title: 'Resumo da semana', description: 'A semana.', arguments: [] },
      { name: 'quebrado', title: 'Quebrado', description: 'Falha.', arguments: [] },
    ]);
    const prompt = await resultOf(request('prompts/get', { name: 'preparar_consulta', arguments: { paciente: 'Ana', minutos: 50, online: true } }), host);
    assert.deepEqual(prompt, { description: 'Preparar a consulta de Ana', messages: [{ role: 'user', content: { type: 'text', text: 'Prepare a consulta de Ana (50).' } }] });
    // Número e sim/não viram texto antes de chegar ao host.
    assert.deepEqual(plain(calls.prompts[0].args), { paciente: 'Ana', minutos: '50', online: 'true' });
    assert.deepEqual(await errorOf(request('prompts/get', { name: 'preparar_consulta' }), host), { code: -32602, message: 'Diga o nome do paciente.' });
    assert.deepEqual(await errorOf(request('prompts/get', { name: 'semana' }), host), { code: -32602, message: 'Unknown prompt: semana' });
    // Fora da lista: nem chega ao host.
    const asked = calls.prompts.length;
    assert.deepEqual(await errorOf(request('prompts/get', { name: 'segredo' }), host), { code: -32602, message: 'Unknown prompt: segredo' });
    assert.equal(calls.prompts.length, asked);
    for (const params of [{}, { name: 7 }, { name: 'preparar_consulta', arguments: ['Ana'] }, { name: 'preparar_consulta', arguments: { paciente: { nome: 'Ana' } } }, { name: 'preparar_consulta', arguments: { paciente: null } }]) {
      assert.equal((await errorOf(request('prompts/get', params), host)).code, -32602, JSON.stringify(params));
    }
    assert.deepEqual(await send(request('prompts/get', { name: 'quebrado' }), host), { status: 200, body: { jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Internal error' } } });
    // Quem decide se o prompt precisa de login é o host (devolvendo texto de erro).
    const anonAsked = [];
    const anon = makeHost({ authenticated: false, getPrompt: async (name) => { anonAsked.push(name); return 'Entre novamente na sua conta.'; } }).host;
    assert.deepEqual(await errorOf(request('prompts/get', { name: 'preparar_consulta', arguments: { paciente: 'Ana' } }), anon), { code: -32602, message: 'Entre novamente na sua conta.' });
    assert.deepEqual(anonAsked, ['preparar_consulta']);
  });

  await check('métodos que não oferecemos: -32601 com status 200', async () => {
    for (const method of ['logging/setLevel', 'completion/complete', 'resources/subscribe', 'resources/unsubscribe', 'sampling/createMessage', 'notifications/initialized', 'rpc.discover', '', '__proto__', 'constructor', 'toString']) {
      const out = await send(request(method, {}, 'm'));
      assert.equal(out.status, 200, method);
      assert.deepEqual(out.body, { jsonrpc: '2.0', id: 'm', error: { code: -32601, message: 'Method not found', data: { method } } }, method);
    }
    const long = await errorOf(request('m'.repeat(1000) + '\n'));
    assert.equal(long.data.method.length, 200);
  });

  await check('lote: na ordem, avisos sem resposta, itens inválidos com erro e limites de tamanho', async () => {
    const order = [];
    const { host } = makeHost({ callTool: async (name, args) => { order.push(args.text || name); return { ok: true, speech: 'ok' }; } });
    const mixed = await send([
      request('tools/call', { name: 'add_followup', arguments: { text: 'primeiro' } }, 1),
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      request('tools/call', { name: 'add_followup', arguments: { text: 'segundo' } }, 2),
      request('tools/list', undefined, 'lista'),
      1,
      [request('ping')],
      { jsonrpc: '2.0', id: 'x', method: 'nada' },
      { jsonrpc: '2.0', id: 10, result: {} },
    ], host);
    assert.equal(mixed.status, 200);
    assert.deepEqual(mixed.body.map((r) => r.id), [1, 2, 'lista', null, null, 'x']);
    assert.deepEqual(mixed.body.slice(3).map((r) => r.error.code), [-32600, -32600, -32601]);
    assert.deepEqual(order, ['primeiro', 'segundo']);
    assert.ok(mixed.body.every((r) => r.jsonrpc === '2.0'));
    // Só avisos e respostas: 202 sem corpo.
    assert.deepEqual(await send([{ jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 3, result: {} }], host), { status: 202, body: null });
    // Lote vazio ou grande demais: envelope inválido.
    for (const batch of [[], Array.from({ length: 21 }, (_, i) => request('ping', undefined, i))]) {
      const out = await send(batch, host);
      assert.equal(out.status, 400);
      assert.equal(out.body.error.code, -32600);
      assert.equal(out.body.id, null);
    }
    const twenty = await send(Array.from({ length: 20 }, (_, i) => request('ping', undefined, i)), host);
    assert.equal(twenty.status, 200);
    assert.deepEqual(twenty.body.map((r) => r.id), Array.from({ length: 20 }, (_, i) => i));
  });

  await check('falha inesperada do host em qualquer método: -32603 genérico, sem o texto da exceção', async () => {
    const host = makeHost().host;
    Object.defineProperty(host, 'tools', { get() { throw new Error(SECRET); } });
    for (const method of ['tools/list', 'tools/call']) {
      const out = await send(request(method, { name: 'list_patients' }), host);
      assert.deepEqual(out, { status: 200, body: { jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'Internal error' } } }, method);
    }
    // O resto continua respondendo.
    assert.deepEqual((await send(request('ping'), host)).body.result, {});
  });

  console.log(`${count} verificações do protocolo MCP passaram. Nenhum serviço externo foi chamado.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
