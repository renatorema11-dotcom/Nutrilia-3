// Testa a credencial de conversa das Alis (lib/ali-session.ts): o agente é escolhido pelo perfil,
// voz recebe token e texto recebe endereço assinado, e sem a chave nada é chamado. A ElevenLabs é simulada.
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { loadLib } = require('./fakes.cjs');

const env = {};
const calls = [];
let next = null;
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const context = loadLib(['ali-session.ts'], {
  AbortSignal, encodeURIComponent,
  process: { env },
  console: { warn: () => {}, error: () => {} },
  fetch: async (url, init) => {
    calls.push({ url, headers: init.headers });
    if (next instanceof Error) throw next;
    return next;
  },
});
const create = async (role, mode) => { context.role = role; context.mode = mode; return JSON.parse(JSON.stringify(await vm.runInContext('createAliSession(role, mode)', context))); };
const reset = (keys, response) => { for (const key of Object.keys(env)) delete env[key]; Object.assign(env, keys); calls.length = 0; next = response; };

let count = 0;
async function check(name, fn) { await fn(); count++; }

(async () => {
  await check('sem a chave no servidor: avisa que não está configurado e não chama a ElevenLabs', async () => {
    reset({}, reply(200, { token: 'x' }));
    assert.deepEqual(await create('patient', 'voice'), { ok: false, status: 503, reason: 'not_configured' });
    assert.equal(calls.length, 0);
  });

  await check('paciente por voz: token do agente dos pacientes, com a chave só no cabeçalho', async () => {
    reset({ ELEVENLABS_API_KEY: 'chave-de-teste' }, reply(200, { token: 'token-de-conversa' }));
    assert.deepEqual(await create('patient', 'voice'), { ok: true, conversationToken: 'token-de-conversa' });
    assert.equal(calls[0].url, 'https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=agent_4901kze5k1xhe5590n67kh1pby82');
    assert.equal(calls[0].headers['xi-api-key'], 'chave-de-teste');
    assert.doesNotMatch(calls[0].url, /chave-de-teste/);
  });

  await check('nutricionista: voz recebe token e texto recebe endereço assinado, sempre do agente dela', async () => {
    reset({ ELEVENLABS_API_KEY: 'k' }, reply(200, { token: 't-voz' }));
    assert.deepEqual(await create('nutritionist', 'voice'), { ok: true, conversationToken: 't-voz' });
    assert.match(calls[0].url, /\/token\?agent_id=agent_2201m4kp5pz6e85tp9demzjejpm0$/);
    reset({ ELEVENLABS_API_KEY: 'k' }, reply(200, { signed_url: 'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=a&conversation_signature=s' }));
    const text = await create('nutritionist', 'text');
    assert.equal(text.ok, true);
    assert.match(text.signedUrl, /^wss:\/\/api\.elevenlabs\.io\//);
    assert.match(calls[0].url, /\/get-signed-url\?agent_id=agent_2201m4kp5pz6e85tp9demzjejpm0$/);
  });

  await check('o agente dos pacientes pode vir da configuração do app', async () => {
    reset({ ELEVENLABS_API_KEY: 'k', NEXT_PUBLIC_ELEVENLABS_AGENT_ID: 'agent_outro' }, reply(200, { token: 't' }));
    await create('patient', 'voice');
    assert.match(calls[0].url, /agent_id=agent_outro$/);
    // O da nutricionista não muda com essa configuração.
    await create('nutritionist', 'voice');
    assert.match(calls[1].url, /agent_id=agent_2201m4kp5pz6e85tp9demzjejpm0$/);
  });

  await check('chave recusada, resposta sem credencial ou rede fora: indisponível, sem vazar detalhes', async () => {
    const unavailable = { ok: false, status: 502, reason: 'unavailable' };
    reset({ ELEVENLABS_API_KEY: 'k' }, reply(401, { detail: { status: 'invalid_api_key', message: 'Invalid API key' } }));
    assert.deepEqual(await create('patient', 'voice'), unavailable);
    reset({ ELEVENLABS_API_KEY: 'k' }, reply(200, { token: '' }));
    assert.deepEqual(await create('patient', 'voice'), unavailable);
    reset({ ELEVENLABS_API_KEY: 'k' }, reply(200, { token: 't' }));
    assert.deepEqual(await create('nutritionist', 'text'), unavailable); // texto precisa de signed_url
    reset({ ELEVENLABS_API_KEY: 'k' }, new Error('fetch failed'));
    assert.deepEqual(await create('patient', 'voice'), unavailable);
  });

  console.log(`${count} verificações da credencial de conversa da Ali passaram. A ElevenLabs não foi chamada.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
