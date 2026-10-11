// Testa a proteção das rotas de IA (login, perfil, limite de uso e tamanho do pedido).
// O login é simulado; nenhum serviço externo é chamado.
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { loadLib } = require('./fakes.cjs');

let caller = null;
const context = loadLib(['ai-guard.ts'], {
  Request, Response,
  verifyCaller: async () => caller,
  json: (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
});
const run = (code) => vm.runInContext(code, context);
const post = (body) => new Request('https://unit.test/api/ia', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
const guard = (body, options = {}) => {
  context.req = post(body);
  context.options = { roles: ['patient'], scope: 'teste', limit: 3, maxChars: 200, ...options };
  return run('guardAi(req, options)');
};

let count = 0;
async function check(name, fn) { await fn(); count++; }

(async () => {
  await check('sem login não passa e nem chega a ler o pedido', async () => {
    caller = null;
    const result = await guard({ a: 1 });
    assert.equal(result.ok, false);
    assert.equal(result.response.status, 401);
    assert.equal(context.req.bodyUsed, false);
  });

  await check('perfil errado não passa', async () => {
    caller = { uid: 'nutri-1', role: 'nutritionist' };
    const result = await guard({ a: 1 });
    assert.equal(result.response.status, 403);
    assert.equal((await guard({ a: 1 }, { roles: ['patient', 'nutritionist'], scope: 'outra' })).ok, true);
  });

  await check('pedido válido devolve quem pediu e o corpo lido', async () => {
    caller = { uid: 'paciente-1', role: 'patient' };
    const result = await guard({ objective: 'Saúde' }, { scope: 'valido' });
    assert.equal(result.ok, true);
    assert.equal(result.caller.uid, 'paciente-1');
    assert.equal(result.body.objective, 'Saúde');
  });

  await check('pedido grande demais, corrompido ou que não é objeto é recusado', async () => {
    caller = { uid: 'paciente-2', role: 'patient' };
    assert.equal((await guard({ texto: 'x'.repeat(500) }, { limit: 50 })).response.status, 413);
    assert.equal((await guard('{ quebrado', { limit: 50 })).response.status, 400);
    assert.equal((await guard([1, 2], { limit: 50 })).response.status, 400);
    assert.equal((await guard('null', { limit: 50 })).response.status, 400);
  });

  await check('limite por pessoa e por função; o de uma não atrapalha a outra', async () => {
    caller = { uid: 'paciente-3', role: 'patient' };
    for (let i = 0; i < 3; i++) assert.equal((await guard({ i }, { scope: 'limite' })).ok, true);
    const blocked = await guard({ i: 4 }, { scope: 'limite' });
    assert.equal(blocked.response.status, 429);
    assert.match((await blocked.response.json()).error, /Aguarde alguns minutos/);
    // Outra função e outra pessoa seguem liberadas.
    assert.equal((await guard({ i: 5 }, { scope: 'outra-funcao' })).ok, true);
    caller = { uid: 'paciente-4', role: 'patient' };
    assert.equal((await guard({ i: 6 }, { scope: 'limite' })).ok, true);
  });

  await check('o limite libera de novo depois de 10 minutos', async () => {
    const t0 = 1_000_000;
    context.t0 = t0;
    assert.equal(run("allowRequest('janela', 2, t0)"), true);
    assert.equal(run("allowRequest('janela', 2, t0 + 1000)"), true);
    assert.equal(run("allowRequest('janela', 2, t0 + 2000)"), false);
    assert.equal(run("allowRequest('janela', 2, t0 + 9 * 60000)"), false);
    assert.equal(run("allowRequest('janela', 2, t0 + 10 * 60000 + 1)"), true);
  });

  await check('textos são cortados e só texto ou número entra no pedido à IA', async () => {
    assert.equal(run("clip('abcdef', 3)"), 'abc');
    assert.equal(run('clip(72.5, 10)'), '72.5');
    assert.equal(run("clip({ a: 1 }, 10)"), '');
    assert.equal(run("clip(['x'], 10)"), '');
    assert.equal(run('clip(null, 10)'), '');
    assert.equal(run("lastMessage([{ text: 'oi' }, { text: 'qual o plano?' }], 5)"), 'qual ');
    assert.equal(run("lastMessage([], 100)"), '');
    assert.equal(run("lastMessage('texto', 100)"), '');
    assert.equal(run("lastMessage([{ text: { nested: true } }], 100)"), '');
  });

  await check('foto: só JPEG, PNG ou WebP em base64', async () => {
    const parse = (value) => { context.image = value; const r = run('parseImage(image)'); return r && r.mimeType; };
    assert.equal(parse('data:image/jpeg;base64,/9j/4AAQ'), 'image/jpeg');
    assert.equal(parse('data:image/png;base64,iVBORw0KGgo='), 'image/png');
    assert.equal(parse('data:image/webp;base64,UklGRg=='), 'image/webp');
    assert.equal(parse('data:image/svg+xml;base64,PHN2Zz4='), null);
    assert.equal(parse('data:text/html;base64,PGh0bWw+'), null);
    assert.equal(parse('data:image/jpeg;base64,<script>'), null);
    assert.equal(parse('https://exemplo.com/foto.jpg'), null);
    assert.equal(parse({ data: 'x' }), null);
    assert.equal(parse(''), null);
  });

  console.log(`${count} verificações da proteção das rotas de IA passaram. Nenhum serviço externo foi chamado.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
