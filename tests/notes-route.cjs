// Testa a rota das anotações das consultas (tela do prontuário): só a nutricionista responsável lê, grava e apaga.
// Login e banco são simulados; nenhum serviço externo é chamado.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { timingSafeEqual } = require('node:crypto');
const assert = require('node:assert/strict');
const { createFirestore } = require('./fakes.cjs');

const strip = (file) => stripTypeScriptTypes(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'))
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/^export (?=(async )?function|const|let)/gm, '');
const code = ['lib/firebase-admin.ts', 'lib/ai-guard.ts', 'lib/consultation-notes.ts', 'app/api/nutritionist/consultation-notes/route.ts'].map(strip).join('\n')
  + '\nthis.GET = GET; this.POST = POST; this.DELETE = DELETE;';

const { store, db } = createFirestore();
const tokens = { 'tk-carla': 'nutri-1', 'tk-outra': 'nutri-2', 'tk-paciente': 'p-ana', 'tk-analise': 'nutri-nova' };
const context = vm.createContext({
  Buffer, Request, Response, URL, console: { error: () => {} }, timingSafeEqual,
  process: { env: { FIREBASE_SERVICE_ACCOUNT_KEY: JSON.stringify({ project_id: 'nutri-test' }) } },
  firebaseConfig: { projectId: 'nutri-test', firestoreDatabaseId: 'named-test-db' },
  getApps: () => [], cert: (a) => a, initializeApp: () => ({ name: 'test' }),
  getAuth: () => ({ verifyIdToken: async (token) => { if (!tokens[token]) throw new Error('token inválido'); return { uid: tokens[token], firebase: { sign_in_provider: 'password' } }; } }),
  getFirestore: () => db,
});
vm.runInContext(code, context);

const call = async (method, token, query = '', body) => {
  const headers = token ? { authorization: `Bearer ${token}`, 'content-type': 'application/json' } : {};
  const init = { method, headers, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) };
  const res = await context[method](new Request(`https://unit.test/api/nutritionist/consultation-notes${query}`, init));
  return { status: res.status, json: await res.json(), cache: res.headers.get('cache-control') };
};
const notesIn = () => [...store.entries()].filter(([key]) => key.startsWith('consultationNotes/')).map(([key, value]) => ({ id: key.split('/')[1], ...value }));

let count = 0;
async function check(name, fn) { await fn(); count++; }

(async () => {
  store.set('users/nutri-1', { role: 'nutritionist' });
  store.set('users/nutri-2', { role: 'nutritionist', approval: 'approved' });
  store.set('users/nutri-nova', { role: 'nutritionist', approval: 'pending' });
  store.set('users/p-ana', { role: 'patient' });
  store.set('patients/p-ana', { name: 'Ana Souza', nutritionistId: 'nutri-1' });
  store.set('patients/p-joao', { name: 'João Pereira', nutritionistId: 'nutri-2' });

  await check('sem login, paciente e nutricionista em análise não entram', async () => {
    for (const token of [null, 'tk-invalido', 'tk-paciente', 'tk-analise']) {
      assert.equal((await call('GET', token, '?patientId=p-ana')).status, 403);
      assert.equal((await call('POST', token, '', { patientId: 'p-ana', text: 'Tentativa de anotação' })).status, 403);
    }
    assert.equal(notesIn().length, 0);
  });

  await check('salvar: só para paciente dela, com texto limpo e marcado como feito na tela', async () => {
    const saved = await call('POST', 'tk-carla', '', { patientId: 'p-ana', text: '  Relatou mais fome à noite.\r\n\r\n\r\nTrocar o lanche.  ' });
    assert.equal(saved.status, 200);
    assert.equal(saved.cache, 'no-store');
    assert.equal(saved.json.note.text, 'Relatou mais fome à noite.\n\nTrocar o lanche.');
    assert.deepEqual(notesIn().map(({ nutritionistId, patientUid, source }) => [nutritionistId, patientUid, source]), [['nutri-1', 'p-ana', 'app']]);
    assert.equal((await call('POST', 'tk-outra', '', { patientId: 'p-ana', text: 'Paciente de outra' })).status, 404);
    assert.equal((await call('POST', 'tk-carla', '', { patientId: 'p-joao', text: 'Paciente de outra' })).status, 404);
    assert.equal((await call('POST', 'tk-carla', '', { patientId: 'nao-existe', text: 'Paciente inexistente' })).status, 404);
    assert.equal((await call('POST', 'tk-carla', '', { patientId: 'p-ana', text: ' a ' })).status, 422);
    assert.equal((await call('POST', 'tk-carla', '', { patientId: 'p-ana', text: 'x'.repeat(4001) })).status, 422);
    assert.equal((await call('POST', 'tk-carla', '', '{')).status, 400);
    assert.equal(notesIn().length, 1);
  });

  await check('ler: só as anotações dela, da mais nova para a mais antiga', async () => {
    store.set('consultationNotes/antiga', { nutritionistId: 'nutri-1', patientUid: 'p-ana', text: 'Primeira consulta.', source: 'ali', createdAt: '2026-09-29T15:00:00.000Z' });
    store.set('consultationNotes/alheia', { nutritionistId: 'nutri-2', patientUid: 'p-ana', text: 'De outra nutricionista.', source: 'app', createdAt: '2030-01-01T00:00:00.000Z' });
    const list = await call('GET', 'tk-carla', '?patientId=p-ana');
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.notes.map((note) => note.text), ['Relatou mais fome à noite.\n\nTrocar o lanche.', 'Primeira consulta.']);
    assert.equal(list.json.notes[1].source, 'ali');
    assert.equal((await call('GET', 'tk-outra', '?patientId=p-ana')).status, 404);
    assert.equal((await call('GET', 'tk-carla', '')).status, 404);
    assert.equal((await call('GET', 'tk-carla', '?patientId=../p-ana')).status, 404);
  });

  await check('apagar: só a dona da anotação', async () => {
    assert.equal((await call('DELETE', 'tk-carla', '?id=alheia')).status, 404);
    assert.equal((await call('DELETE', 'tk-outra', '?id=antiga')).status, 404);
    assert.equal((await call('DELETE', 'tk-paciente', '?id=antiga')).status, 403);
    assert.equal((await call('DELETE', 'tk-carla', '?id=antiga')).status, 200);
    assert.deepEqual(notesIn().map((note) => note.id).sort(), ['alheia', notesIn().find((note) => note.nutritionistId === 'nutri-1').id].sort());
    assert.equal(store.has('consultationNotes/antiga'), false);
  });

  console.log(`${count} verificações das anotações das consultas passaram. Nenhum serviço externo foi chamado.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
