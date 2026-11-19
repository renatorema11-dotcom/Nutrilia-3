// Testa a memória da Ali da nutricionista (lib/ali-memory.ts): o jeito de trabalhar dela (preferências) e as pendências,
// com o Firestore simulado. Confere também que uma nutricionista nunca vê nem mexe na memória de outra.
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createFirestore, loadLib } = require('./fakes.cjs');

const { store, db } = createFirestore();
const context = loadLib(['ali-settings.ts', 'ali-memory.ts'], {});
context.db = db;
const run = (code) => vm.runInContext(code, context);
const plain = (value) => JSON.parse(JSON.stringify(value));
// Os argumentos entram pelo contexto (sem virar texto), sempre depois do db.
const call = (fn, ...args) => { context.args = args; return run(`${fn}(db, ...args)`); };

const TODAY = '2026-10-13';
// Relógio fixo que anda um minuto a cada item gravado: a ordem de criação fica clara.
let clock = Date.parse('2026-10-13T13:00:00Z');
const tick = () => new Date(clock += 60_000);
const memory = (filter = () => true) => [...store.entries()].filter(([key, value]) => key.startsWith('aliMemory/') && filter(value));
const seed = (id, data) => store.set(`aliMemory/${id}`, data);

let count = 0;
async function check(name, fn) {
  try { await fn(); } catch (error) { error.message = `${name}: ${error.message}`; throw error; }
  count++;
}

(async () => {
  let firstId;

  await check('preferência: anota limpa, com a fonte e a data, e diz o que vai lembrar', async () => {
    const saved = await call('rememberPreference', 'nutri-1', { text: '  Prefiro planos com\n cinco refeições  ' }, 'ali', tick());
    assert.equal(saved.ok, true);
    assert.equal(saved.speech, 'Anotado. Vou lembrar: Prefiro planos com cinco refeições.');
    firstId = saved.preference.id;
    assert.deepEqual(plain(saved.preference), { id: firstId, text: 'Prefiro planos com cinco refeições' });
    assert.deepEqual(store.get(`aliMemory/${firstId}`), { nutritionistId: 'nutri-1', kind: 'preference', text: 'Prefiro planos com cinco refeições', source: 'ali', createdAt: '2026-10-13T13:01:00.000Z' });
    // Pela tela; chaves de variável da ElevenLabs saem do texto; fonte desconhecida vira "ali".
    const app = await call('rememberPreference', 'nutri-1', { text: 'Uso medidas caseiras {nome}' }, 'app', tick());
    assert.deepEqual([store.get(`aliMemory/${app.preference.id}`).source, store.get(`aliMemory/${app.preference.id}`).text], ['app', 'Uso medidas caseiras nome']);
    const odd = await call('rememberPreference', 'nutri-1', { text: 'Gosto de lanches práticos!' }, 'qualquer', tick());
    assert.equal(odd.speech, 'Anotado. Vou lembrar: Gosto de lanches práticos!');
    assert.equal(store.get(`aliMemory/${odd.preference.id}`).source, 'ali');
  });

  await check('preferência: vazia, curta, longa demais, sem palavras ou de conta não confirmada é recusada e nada é gravado', async () => {
    const before = memory().length;
    for (const text of ['', 'ok', '   ', '!!!', 'x'.repeat(301), 42, null, ['lista']]) {
      const result = await call('rememberPreference', 'nutri-1', { text }, 'ali', tick());
      assert.equal(result.status, 422, JSON.stringify(text));
      assert.equal(result.ok, false);
    }
    assert.match((await call('rememberPreference', 'nutri-1', { text: 'x'.repeat(301) })).speech, /longo demais/);
    assert.equal((await call('rememberPreference', 'nutri-1', undefined)).status, 422);
    assert.equal((await call('rememberPreference', 'nutri-1', 'texto solto')).status, 422);
    assert.equal((await call('rememberPreference', '', { text: 'Prefiro planos curtos' })).status, 403);
    assert.equal((await call('rememberPreference', undefined, { text: 'Prefiro planos curtos' })).status, 403);
    assert.equal(memory().length, before);
    // 300 caracteres ainda cabem.
    const max = await call('rememberPreference', 'nutri-limite', { text: 'a'.repeat(300) }, 'ali', tick());
    assert.equal(max.ok, true);
    assert.equal(await call('removeMemoryItem', 'nutri-limite', max.preference.id), true);
  });

  await check('preferência repetida, com outro acento ou maiúscula, não duplica', async () => {
    const before = memory().length;
    const again = await call('rememberPreference', 'nutri-1', { text: 'prefiro PLANOS com cinco refeicoes.' }, 'ali', tick());
    assert.equal(again.ok, true);
    assert.equal(again.speech, 'Isso eu já tinha anotado.');
    assert.equal(again.preference.id, firstId);
    assert.equal(memory().length, before);
  });

  await check('limite de 40 preferências por nutricionista; as de outra e as pendências não contam', async () => {
    for (let i = 1; i <= 40; i++) seed(`cheia-${i}`, { nutritionistId: 'nutri-cheia', kind: 'preference', text: `Preferência número ${i}`, source: 'app', createdAt: `2026-09-01T10:${String(i).padStart(2, '0')}:00.000Z` });
    seed('cheia-pendencia', { nutritionistId: 'nutri-cheia', kind: 'followup', text: 'Uma pendência qualquer', status: 'open', createdAt: '2026-09-02T10:00:00.000Z' });
    const full = await call('rememberPreference', 'nutri-cheia', { text: 'Mais uma preferência' }, 'ali', tick());
    assert.equal(full.status, 409);
    assert.match(full.speech, /^Já tenho 40 preferências suas anotadas, que é o máximo\. Peça para eu esquecer alguma/);
    // Repetir uma que já existe continua respondendo "já tinha anotado".
    assert.equal((await call('rememberPreference', 'nutri-cheia', { text: 'preferencia numero 7' })).speech, 'Isso eu já tinha anotado.');
    // A outra nutricionista cheia não atrapalha a nutri-1.
    assert.equal((await call('rememberPreference', 'nutri-1', { text: 'Evitar lactose no café da manhã' }, 'ali', tick())).ok, true);
    assert.equal(memory((v) => v.nutritionistId === 'nutri-cheia' && v.kind === 'preference').length, 40);
  });

  await check('lista de preferências: da mais antiga para a mais nova, numeradas, só as dela, e dados estranhos não quebram', async () => {
    seed('n2-pref', { nutritionistId: 'nutri-2', kind: 'preference', text: 'Segredo da outra nutricionista', source: 'ali', createdAt: '2026-10-01T00:00:00.000Z' });
    seed('n1-quebrada', { nutritionistId: 'nutri-1', kind: 'preference', text: 42, createdAt: '2026-10-01T00:00:00.000Z' });
    seed('n1-vazia', { nutritionistId: 'nutri-1', kind: 'preference', createdAt: '2026-10-01T00:00:00.000Z' });
    seed('n1-sem-data', { nutritionistId: 'nutri-1', kind: 'preference', text: 'Atendo crianças só com os pais', source: 99 });
    seed('n1-tipo-errado', { nutritionistId: 'nutri-1', kind: 'outra-coisa', text: 'Não é preferência' });
    const loaded = plain(await call('loadPreferences', 'nutri-1'));
    assert.deepEqual(loaded.map((item) => item.text), ['Atendo crianças só com os pais', 'Prefiro planos com cinco refeições', 'Uso medidas caseiras nome', 'Gosto de lanches práticos!', 'Evitar lactose no café da manhã']);
    assert.deepEqual(loaded[0], { id: 'n1-sem-data', text: 'Atendo crianças só com os pais', createdAt: '', source: 'ali' });
    const list = await call('listPreferences', 'nutri-1');
    assert.equal(list.speech, 'Tenho 5 preferências suas anotadas. Primeira: Atendo crianças só com os pais. Segunda: Prefiro planos com cinco refeições. '
      + 'Terceira: Uso medidas caseiras nome. Quarta: Gosto de lanches práticos! Quinta: Evitar lactose no café da manhã.');
    assert.equal(list.preferences.length, 5);
    assert.ok(!JSON.stringify(plain(list)).includes('Segredo'));
    assert.deepEqual(plain(await call('loadPreferences', 'nutri-2')).map((item) => item.text), ['Segredo da outra nutricionista']);
    store.delete('aliMemory/n1-sem-data');
  });

  await check('lista de preferências: nenhuma, uma só, mais de oito e textos longos (fala curta, "E mais N")', async () => {
    const empty = await call('listPreferences', 'nutri-vazia');
    assert.equal(empty.ok, true);
    assert.match(empty.speech, /^Ainda não tenho nenhuma preferência sua anotada\. Se quiser, é só dizer/);
    assert.deepEqual(plain(empty.preferences), []);
    seed('uma-1', { nutritionistId: 'nutri-uma', kind: 'preference', text: 'Prefiro atender de manhã', source: 'ali', createdAt: '2026-10-01T00:00:00.000Z' });
    assert.equal((await call('listPreferences', 'nutri-uma')).speech, 'Tenho uma preferência sua anotada: Prefiro atender de manhã.');
    const many = await call('listPreferences', 'nutri-cheia');
    assert.match(many.speech, /^Tenho 40 preferências suas anotadas\. Primeira: Preferência número 1\. Segunda: Preferência número 2\./);
    assert.match(many.speech, /Oitava: Preferência número 8\. E mais 32\.$/);
    assert.equal(many.preferences.length, 40);
    for (let i = 1; i <= 10; i++) seed(`longa-${i}`, { nutritionistId: 'nutri-longa', kind: 'preference', text: `Item ${i} ${'texto comprido '.repeat(19).trim()}`, source: 'ali', createdAt: `2026-09-01T10:0${i - 1}:00.000Z` });
    const long = await call('listPreferences', 'nutri-longa');
    assert.ok(long.speech.length <= 600, String(long.speech.length));
    assert.match(long.speech, /^Tenho 10 preferências suas anotadas\. Primeira: Item 1 texto/);
    assert.match(long.speech, / E mais \d\.$/);
  });

  await check('esquecer preferência pelo id: só a dela e só preferência', async () => {
    assert.equal((await call('forgetPreference', 'nutri-1', { id: 'n2-pref' })).status, 404);
    assert.equal(store.has('aliMemory/n2-pref'), true);
    seed('n1-pendencia', { nutritionistId: 'nutri-1', kind: 'followup', text: 'Pendência, não preferência', status: 'open' });
    assert.equal((await call('forgetPreference', 'nutri-1', { id: 'n1-pendencia' })).status, 404);
    assert.equal(store.has('aliMemory/n1-pendencia'), true);
    store.delete('aliMemory/n1-pendencia');
    for (const id of ['../n2-pref', 'nao-existe', 42, 'x'.repeat(129)]) assert.equal((await call('forgetPreference', 'nutri-1', { id })).status, 404, String(id));
    const removed = await call('forgetPreference', 'nutri-1', { id: 'n1-quebrada' });
    assert.deepEqual([removed.ok, removed.speech], [true, 'Pronto, esqueci essa preferência.']);
    assert.equal(store.has('aliMemory/n1-quebrada'), false);
    store.delete('aliMemory/n1-vazia');
  });

  await check('esquecer preferência pelas palavras: uma só, nenhuma, várias (pergunta qual) e o texto exato vence', async () => {
    const one = await call('forgetPreference', 'nutri-1', { text: 'a preferência das medidas caseiras' });
    assert.equal(one.speech, 'Pronto, esqueci: Uso medidas caseiras nome.');
    assert.equal(store.has(`aliMemory/${one.removed.id}`), false);
    assert.equal(one.removed.text, 'Uso medidas caseiras nome');

    const none = await call('forgetPreference', 'nutri-1', { text: 'chocolate amargo' });
    assert.equal(none.status, 404);
    assert.match(none.speech, /^Não achei nenhuma preferência com chocolate amargo\. Qual delas você quer que eu esqueça\?/);

    assert.equal((await call('rememberPreference', 'nutri-1', { text: 'Evitar lactose no jantar' }, 'ali', tick())).ok, true);
    const before = memory().length;
    const both = await call('forgetPreference', 'nutri-1', { text: 'lactose' });
    assert.equal(both.status, 409);
    assert.equal(both.speech, 'Encontrei duas preferências com essas palavras. Primeira: Evitar lactose no café da manhã. Segunda: Evitar lactose no jantar. Qual delas você quer que eu esqueça?');
    assert.equal(memory().length, before);
    // Muitas parecidas: cita só três.
    const lots = await call('forgetPreference', 'nutri-cheia', { text: 'preferência número' });
    assert.equal(lots.status, 409);
    assert.match(lots.speech, /^Encontrei 40 preferências com essas palavras\. Primeira: Preferência número 1\. Segunda: Preferência número 2\. Terceira: Preferência número 3\. E mais 37\. Qual delas/);

    const exact = await call('forgetPreference', 'nutri-1', { text: 'evitar lactose no jantar' });
    assert.equal(exact.speech, 'Pronto, esqueci: Evitar lactose no jantar.');
    assert.deepEqual(plain(await call('loadPreferences', 'nutri-1')).map((item) => item.text), ['Prefiro planos com cinco refeições', 'Gosto de lanches práticos!', 'Evitar lactose no café da manhã']);

    for (const input of [{}, { text: '' }, { text: '!!!' }, undefined, { id: null, text: ' ' }]) assert.equal((await call('forgetPreference', 'nutri-1', input)).status, 422);
    assert.equal((await call('forgetPreference', 'nutri-vazia', { text: 'qualquer coisa' })).speech, 'Você não tem nenhuma preferência anotada.');
    // A outra nutricionista não apaga a preferência da nutri-1 pelas palavras.
    assert.equal((await call('forgetPreference', 'nutri-2', { text: 'cinco refeições' })).status, 404);
    assert.equal(memory((v) => v.nutritionistId === 'nutri-1' && v.text === 'Prefiro planos com cinco refeições').length, 1);
  });

  await check('memória para o prompt da IA: "1) …; 2) …", só as dela, cortada entre itens', async () => {
    assert.equal(await call('memoryForPrompt', 'nutri-vazia'), '');
    assert.equal(await call('memoryForPrompt', ''), '');
    assert.equal(await call('memoryForPrompt', 'nutri-1'), '1) Prefiro planos com cinco refeições; 2) Gosto de lanches práticos!; 3) Evitar lactose no café da manhã');
    assert.equal(await call('memoryForPrompt', 'nutri-2'), '1) Segredo da outra nutricionista');
    const long = await call('memoryForPrompt', 'nutri-longa');
    assert.ok(long.length <= 1200, String(long.length));
    const items = long.split('; ');
    assert.equal(items.length, 4);
    assert.equal(items[3], `4) Item 4 ${'texto comprido '.repeat(19).trim()}`);
    assert.ok(!(await call('memoryForPrompt', 'nutri-1')).includes('Segredo'));
  });

  const ana = { uid: 'p-ana', name: 'Ana Souza' };
  let examId;

  await check('pendência: com paciente e data, sem nada, para hoje e para o ano que vem', async () => {
    const exam = await call('addFollowup', 'nutri-1', ana, { text: 'Pedir os exames de sangue', dueDate: '2026-10-20' }, TODAY, 'ali', tick());
    assert.equal(exam.ok, true);
    assert.equal(exam.speech, 'Pendência anotada: Pedir os exames de sangue, de Ana Souza, para 20 de outubro.');
    examId = exam.followup.id;
    assert.deepEqual(store.get(`aliMemory/${examId}`), {
      nutritionistId: 'nutri-1', kind: 'followup', text: 'Pedir os exames de sangue', createdAt: new Date(clock).toISOString(), source: 'ali',
      patientUid: 'p-ana', patientName: 'Ana Souza', dueDate: '2026-10-20', status: 'open', doneAt: null,
    });
    assert.deepEqual(plain(exam.followup), { id: examId, text: 'Pedir os exames de sangue', createdAt: new Date(clock).toISOString(), source: 'ali', patientUid: 'p-ana', patientName: 'Ana Souza', dueDate: '2026-10-20', status: 'open', doneAt: null });

    const plainOne = await call('addFollowup', 'nutri-1', null, { text: 'Revisar o modelo de plano vegetariano.' }, TODAY, 'app', tick());
    assert.equal(plainOne.speech, 'Pendência anotada: Revisar o modelo de plano vegetariano.');
    assert.deepEqual([plainOne.followup.patientUid, plainOne.followup.patientName, plainOne.followup.dueDate, plainOne.followup.source], [null, null, null, 'app']);
    assert.equal((await call('addFollowup', 'nutri-1', null, { text: 'Responder o laboratório', dueDate: TODAY }, TODAY, 'ali', tick())).speech, 'Pendência anotada: Responder o laboratório, para 13 de outubro.');
    assert.equal((await call('addFollowup', 'nutri-1', null, { text: 'Renovar o seguro do consultório', dueDate: '2027-01-05' }, TODAY, 'ali', tick())).speech, 'Pendência anotada: Renovar o seguro do consultório, para 5 de janeiro de 2027.');
    // Data vazia é sem data; paciente com uid inválido não fica ligado (nem o nome).
    const loose = await call('addFollowup', 'nutri-1', { uid: 'a/b', name: 'Fulano' }, { text: 'Conferir a balança', dueDate: '' }, TODAY, 'ali', tick());
    assert.deepEqual([loose.ok, loose.followup.patientUid, loose.followup.patientName, loose.followup.dueDate], [true, null, null, null]);
    store.delete(`aliMemory/${loose.followup.id}`);
  });

  await check('pendência: data impossível, que já passou ou texto ruim é recusado e nada é gravado', async () => {
    const before = memory().length;
    for (const dueDate of ['2026-02-30', '2026-13-01', '2026-10-32', 'amanhã', '20/10/2026', 20261020, '2026-10-12', '2025-12-31']) {
      const result = await call('addFollowup', 'nutri-1', ana, { text: 'Ligar para a paciente', dueDate }, TODAY, 'ali', tick());
      assert.equal(result.status, 422, String(dueDate));
    }
    assert.match((await call('addFollowup', 'nutri-1', ana, { text: 'Ligar para a paciente', dueDate: '2026-10-12' }, TODAY)).speech, /^Essa data já passou\./);
    assert.match((await call('addFollowup', 'nutri-1', ana, { text: 'Ligar para a paciente', dueDate: '2026-02-30' }, TODAY)).speech, /^Não entendi a data/);
    for (const text of ['', 'oi', 'x'.repeat(301), 7]) assert.equal((await call('addFollowup', 'nutri-1', ana, { text }, TODAY)).status, 422);
    assert.equal((await call('addFollowup', 'nutri-1', ana, null, TODAY)).status, 422);
    assert.equal((await call('addFollowup', '', ana, { text: 'Ligar para a paciente' }, TODAY)).status, 403);
    assert.equal(memory().length, before);
    // Dia de hoje inválido vindo da rota: usa a data do relógio, e o passado continua recusado.
    assert.equal((await call('addFollowup', 'nutri-1', ana, { text: 'Ligar para a paciente', dueDate: '2026-10-12' }, 'ontem', 'ali', tick())).status, 422);
  });

  await check('pendência repetida não duplica; limite de 100 abertas, e as concluídas não contam', async () => {
    const before = memory().length;
    const again = await call('addFollowup', 'nutri-1', ana, { text: 'pedir os EXAMES de sangue', dueDate: '2026-10-20' }, TODAY, 'ali', tick());
    assert.deepEqual([again.ok, again.speech, again.followup.id], [true, 'Essa pendência já estava anotada.', examId]);
    assert.equal(memory().length, before);
    // Mesmo texto para outra data é outra pendência.
    const other = await call('addFollowup', 'nutri-1', ana, { text: 'Pedir os exames de sangue', dueDate: '2026-11-20' }, TODAY, 'ali', tick());
    assert.notEqual(other.followup.id, examId);
    store.delete(`aliMemory/${other.followup.id}`);

    for (let i = 1; i <= 99; i++) seed(`cheia-f${i}`, { nutritionistId: 'nutri-cheia', kind: 'followup', text: `Tarefa ${i}`, status: 'open', createdAt: '2026-09-03T10:00:00.000Z' });
    for (let i = 1; i <= 5; i++) seed(`cheia-feita${i}`, { nutritionistId: 'nutri-cheia', kind: 'followup', text: `Feita ${i}`, status: 'done', doneAt: '2026-09-04T10:00:00.000Z', createdAt: '2026-09-03T10:00:00.000Z' });
    // 99 + "Uma pendência qualquer" = 100 abertas.
    const full = await call('addFollowup', 'nutri-cheia', null, { text: 'Mais uma tarefa' }, TODAY, 'ali', tick());
    assert.equal(full.status, 409);
    assert.match(full.speech, /^Você já tem 100 pendências abertas, que é o máximo\./);
    store.delete('aliMemory/cheia-f99');
    assert.equal((await call('addFollowup', 'nutri-cheia', null, { text: 'Mais uma tarefa' }, TODAY, 'ali', tick())).ok, true);
    assert.equal((await call('addFollowup', 'nutri-cheia', null, { text: 'E outra tarefa' }, TODAY, 'ali', tick())).status, 409);
  });

  // Pendências de uma nutricionista só para conferir a ordem e a fala.
  const N = 'nutri-ordem';
  const followup = (id, data) => seed(id, { nutritionistId: N, kind: 'followup', status: 'open', source: 'ali', patientUid: null, patientName: null, dueDate: null, doneAt: null, ...data });

  await check('ordem das pendências: com data primeiro (atrasadas antes), depois sem data por criação; concluídas só se pedir', async () => {
    followup('o-c', { text: 'Renovar o registro no conselho', dueDate: '2026-10-30', createdAt: '2026-09-01T10:00:00.000Z' });
    followup('o-e', { text: 'Ler o artigo sobre jejum', createdAt: '2026-09-10T10:00:00.000Z' });
    followup('o-a', { text: 'Ligar para a Ana sobre o exame', patientUid: 'p-ana', patientName: 'Ana Souza', dueDate: '2026-10-10', createdAt: '2026-10-01T10:00:00.000Z' });
    followup('o-d', { text: 'Organizar as receitas', createdAt: '2026-09-15T10:00:00.000Z' });
    followup('o-b', { text: 'Enviar o cardápio da semana', patientUid: 'p-joao', patientName: 'João Pereira', dueDate: TODAY, createdAt: '2026-10-02T10:00:00.000Z' });
    followup('o-f', { text: 'Pendência já feita', status: 'done', doneAt: '2026-10-12T10:00:00.000Z', dueDate: '2026-10-01', createdAt: '2026-08-01T10:00:00.000Z' });
    followup('o-g', { text: 'Comprar balança nova', dueDate: 'amanhã', createdAt: '2026-10-05T10:00:00.000Z' });
    followup('o-h', { text: 42, createdAt: '2026-10-05T10:00:00.000Z' });
    followup('o-j', { text: 'Atualizar o site', status: 'qualquer', patientUid: 7, patientName: 'Sem uid', createdAt: '2026-10-06T10:00:00.000Z' });
    seed('o-alheia', { nutritionistId: 'nutri-2', kind: 'followup', text: 'Pendência da outra nutricionista', status: 'open', patientUid: 'p-ana', patientName: 'Ana Souza', dueDate: '2026-10-01', createdAt: '2026-10-01T10:00:00.000Z' });
    seed('o-alheia-tipo', { nutritionistId: N, kind: 'preference', text: 'Preferência não é pendência', createdAt: '2026-10-01T10:00:00.000Z' });

    const ids = async (options) => plain(await call('loadFollowups', N, ...(options ? [options] : []))).map((item) => item.id);
    assert.deepEqual(await ids(), ['o-a', 'o-b', 'o-c', 'o-e', 'o-d', 'o-g', 'o-j']);
    assert.deepEqual(await ids({ includeDone: true }), ['o-a', 'o-b', 'o-c', 'o-e', 'o-d', 'o-g', 'o-j', 'o-f']);
    assert.deepEqual(await ids({ patientUid: 'p-ana' }), ['o-a']);
    assert.deepEqual(await ids({ patientUid: 'p-ana', includeDone: true }), ['o-a']);
    assert.deepEqual(await ids({ patientUid: 'a/b' }), []);
    assert.deepEqual(await ids({ patientUid: '' }), ['o-a', 'o-b', 'o-c', 'o-e', 'o-d', 'o-g', 'o-j']);
    const odd = plain(await call('loadFollowups', N)).find((item) => item.id === 'o-j');
    assert.deepEqual(odd, { id: 'o-j', text: 'Atualizar o site', createdAt: '2026-10-06T10:00:00.000Z', source: 'ali', patientUid: null, patientName: null, dueDate: null, status: 'open', doneAt: null });
    assert.equal(plain(await call('loadFollowups', N)).find((item) => item.id === 'o-g').dueDate, null);
    assert.equal(plain(await call('loadFollowups', N, { includeDone: true })).find((item) => item.id === 'o-f').doneAt, '2026-10-12T10:00:00.000Z');
    assert.deepEqual(plain(await call('loadFollowups', 'nutri-2')).map((item) => item.id), ['o-alheia']);
    assert.deepEqual(plain(await call('loadFollowups', '')), []);
  });

  await check('pendências faladas: quantas, quantas atrasadas, até seis itens com paciente e data, e "E mais N"', async () => {
    const all = await call('listFollowups', N, {}, TODAY);
    assert.equal(all.speech, 'Você tem 7 pendências abertas, uma atrasada. Ligar para a Ana sobre o exame, de Ana Souza, para 10 de outubro. '
      + 'Enviar o cardápio da semana, de João Pereira, para 13 de outubro. Renovar o registro no conselho, para 30 de outubro. '
      + 'Ler o artigo sobre jejum. Organizar as receitas. Comprar balança nova. E mais 1.');
    assert.deepEqual([all.total, all.overdue, all.dueToday, all.followups.length], [7, 1, 1, 7]);
    assert.ok(!JSON.stringify(plain(all)).includes('outra nutricionista'));

    const due = await call('listFollowups', N, { scope: 'due' }, TODAY);
    assert.equal(due.speech, 'Você tem duas pendências para resolver: uma atrasada e uma para hoje. Ligar para a Ana sobre o exame, de Ana Souza, para 10 de outubro. Enviar o cardápio da semana, de João Pereira, para 13 de outubro.');
    assert.deepEqual(plain(due.followups).map((item) => item.id), ['o-a', 'o-b']);
    // No dia seguinte, as duas estão atrasadas.
    assert.match((await call('listFollowups', N, { scope: 'due' }, '2026-10-14')).speech, /^Você tem duas pendências atrasadas\. Ligar/);
    // Do paciente: o nome entra uma vez só, na abertura.
    assert.equal((await call('listFollowups', N, { patientUid: 'p-ana' }, TODAY)).speech, 'Você tem uma pendência aberta de Ana Souza, que está atrasada. Ligar para a Ana sobre o exame, para 10 de outubro.');
    assert.match((await call('listFollowups', N, {}, '2026-11-15')).speech, /^Você tem 7 pendências abertas, 3 atrasadas\. /);
    seed('duas-1', { nutritionistId: 'nutri-duas', kind: 'followup', text: 'Primeira tarefa', status: 'open', dueDate: '2026-10-01', createdAt: '2026-09-01T10:00:00.000Z' });
    seed('duas-2', { nutritionistId: 'nutri-duas', kind: 'followup', text: 'Segunda tarefa', status: 'open', dueDate: '2026-10-02', createdAt: '2026-09-01T10:00:00.000Z' });
    assert.equal((await call('listFollowups', 'nutri-duas', {}, TODAY)).speech, 'Você tem duas pendências abertas, as duas atrasadas. Primeira tarefa, para 1º de outubro. Segunda tarefa, para 2 de outubro.');
    assert.equal((await call('listFollowups', N, { patientUid: 'p-joao', scope: 'due' }, TODAY)).speech, 'Para hoje, você tem uma pendência de João Pereira. Enviar o cardápio da semana, para 13 de outubro.');
    assert.equal((await call('listFollowups', N, { patientUid: 'p-bia' }, TODAY)).speech, 'Não há pendências abertas desse paciente.');
    assert.equal((await call('listFollowups', N, { patientUid: 'a/b' }, TODAY)).total, 0);
    assert.equal((await call('listFollowups', 'nutri-vazia', {}, TODAY)).speech, 'Você não tem pendências abertas.');
    assert.equal((await call('listFollowups', 'nutri-vazia', undefined, TODAY)).speech, 'Você não tem pendências abertas.');
    seed('futuro-1', { nutritionistId: 'nutri-futuro', kind: 'followup', text: 'Preparar a palestra', status: 'open', dueDate: '2026-12-01', createdAt: '2026-10-01T10:00:00.000Z' });
    assert.equal((await call('listFollowups', 'nutri-futuro', { scope: 'due' }, TODAY)).speech, 'Nenhuma pendência para hoje nem atrasada. Há uma pendência aberta para outros dias ou sem data.');
    assert.equal((await call('listFollowups', 'nutri-futuro', { scope: 'tudo' }, TODAY)).speech, 'Você tem uma pendência aberta. Preparar a palestra, para 1º de dezembro.');
    // Textos longos: a fala continua curta.
    for (let i = 1; i <= 10; i++) seed(`longa-f${i}`, { nutritionistId: 'nutri-longa', kind: 'followup', text: `Tarefa ${i} ${'detalhe comprido '.repeat(17).trim()}`, status: 'open', createdAt: `2026-09-01T10:0${i - 1}:00.000Z` });
    const long = await call('listFollowups', 'nutri-longa', {}, TODAY);
    assert.ok(long.speech.length <= 600, String(long.speech.length));
    assert.match(long.speech, /^Você tem 10 pendências abertas\. Tarefa 1 detalhe/);
    assert.match(long.speech, / E mais \d\.$/);
    // A nutri-2 não ouve as pendências da nutri-ordem.
    const other = await call('listFollowups', 'nutri-2', {}, TODAY);
    assert.equal(other.speech, 'Você tem uma pendência aberta, que está atrasada. Pendência da outra nutricionista, de Ana Souza, para 1º de outubro.');
  });

  await check('concluir pendência pelo id: só a dela, só pendência, e repetir não muda nada', async () => {
    assert.equal((await call('completeFollowup', 'nutri-1', { id: 'o-alheia' }, tick())).status, 404);
    assert.equal(store.get('aliMemory/o-alheia').status, 'open');
    assert.equal((await call('completeFollowup', 'nutri-1', { id: firstId }, tick())).status, 404); // preferência
    assert.equal((await call('completeFollowup', 'nutri-1', { id: '../o-alheia' }, tick())).status, 404);
    assert.equal((await call('completeFollowup', 'nutri-1', { id: examId, patientUid: 'p-joao' }, tick())).status, 404);
    assert.equal(store.get(`aliMemory/${examId}`).status, 'open');

    const done = await call('completeFollowup', 'nutri-1', { id: examId }, tick());
    assert.equal(done.speech, 'Pronto, pendência concluída: Pedir os exames de sangue, de Ana Souza.');
    const doneAt = new Date(clock).toISOString();
    assert.deepEqual([store.get(`aliMemory/${examId}`).status, store.get(`aliMemory/${examId}`).doneAt], ['done', doneAt]);
    assert.deepEqual([done.followup.status, done.followup.doneAt], ['done', doneAt]);
    assert.equal(store.get(`aliMemory/${examId}`).nutritionistId, 'nutri-1'); // o resto do item continua igual
    const again = await call('completeFollowup', 'nutri-1', { id: examId }, tick());
    assert.deepEqual([again.ok, again.speech, again.alreadyDone], [true, 'Essa pendência já estava concluída.', true]);
    assert.equal(store.get(`aliMemory/${examId}`).doneAt, doneAt);
  });

  await check('concluir pendência pelas palavras: vale o nome do paciente; nenhuma, várias e as já feitas', async () => {
    const byName = await call('completeFollowup', N, { text: 'o cardápio do João' }, tick());
    assert.equal(byName.speech, 'Pronto, pendência concluída: Enviar o cardápio da semana, de João Pereira.');
    assert.equal(store.get('aliMemory/o-b').status, 'done');
    // Sem texto, de um paciente com uma pendência só: é ela.
    const onlyOne = await call('completeFollowup', N, { patientUid: 'p-ana' }, tick());
    assert.equal(onlyOne.speech, 'Pronto, pendência concluída: Ligar para a Ana sobre o exame, de Ana Souza.');
    assert.equal((await call('completeFollowup', N, { patientUid: 'p-ana' }, tick())).speech, 'Não há pendências abertas desse paciente.');

    assert.equal((await call('addFollowup', 'nutri-1', { uid: 'p-bia', name: 'Bia Costa' }, { text: 'Revisar o plano da Bia' }, TODAY, 'ali', tick())).ok, true);
    const both = await call('completeFollowup', 'nutri-1', { text: 'revisar' }, tick());
    assert.equal(both.status, 409);
    assert.equal(both.speech, 'Encontrei duas pendências abertas com essas palavras. Primeira: Revisar o modelo de plano vegetariano. Segunda: Revisar o plano da Bia, de Bia Costa. Qual delas você quer concluir?');
    assert.equal(memory((v) => v.nutritionistId === 'nutri-1' && v.kind === 'followup' && v.status === 'done').length, 1);
    // Só entre as do paciente, a mesma palavra aponta para uma só.
    assert.equal((await call('completeFollowup', 'nutri-1', { text: 'revisar', patientUid: 'p-bia' }, tick())).speech, 'Pronto, pendência concluída: Revisar o plano da Bia, de Bia Costa.');

    const none = await call('completeFollowup', 'nutri-1', { text: 'chocolate' }, tick());
    assert.equal(none.status, 404);
    assert.match(none.speech, /^Não achei nenhuma pendência aberta com chocolate\./);
    // A que já foi concluída não entra na busca.
    assert.equal((await call('completeFollowup', 'nutri-1', { text: 'exames de sangue' }, tick())).status, 404);
    for (const input of [{}, { text: '' }, { text: '???' }, undefined]) assert.equal((await call('completeFollowup', 'nutri-1', input, tick())).status, 422);
    assert.equal((await call('completeFollowup', 'nutri-vazia', { text: 'qualquer coisa' }, tick())).speech, 'Você não tem pendências abertas.');
    // A outra nutricionista não conclui as da nutri-1 pelas palavras.
    assert.equal((await call('completeFollowup', 'nutri-2', { text: 'modelo de plano vegetariano' }, tick())).status, 404);
    assert.equal(memory((v) => v.text === 'Revisar o modelo de plano vegetariano.' || v.text === 'Revisar o modelo de plano vegetariano')[0][1].status, 'open');
  });

  await check('apagar item pela tela: só da dona, e id estranho não apaga nada', async () => {
    const before = memory().length;
    assert.equal(await call('removeMemoryItem', 'nutri-2', firstId), false);
    assert.equal(await call('removeMemoryItem', 'nutri-1', 'o-alheia'), false);
    for (const id of ['nao-existe', '../o-alheia', 42, null, undefined, '']) assert.equal(await call('removeMemoryItem', 'nutri-1', id), false, String(id));
    assert.equal(await call('removeMemoryItem', '', firstId), false);
    assert.equal(memory().length, before);
    assert.equal(await call('removeMemoryItem', 'nutri-1', examId), true);
    assert.equal(store.has(`aliMemory/${examId}`), false);
    assert.equal(await call('removeMemoryItem', 'nutri-1', firstId), true);
    assert.equal(store.has(`aliMemory/${firstId}`), false);
    assert.equal(memory().length, before - 2);
  });

  await check('LGPD: apaga as pendências do paciente em qualquer nutricionista, e só elas', async () => {
    assert.equal((await call('addFollowup', 'nutri-1', ana, { text: 'Mandar a receita de bolo para a Ana' }, TODAY, 'ali', tick())).ok, true);
    const ofAna = memory((v) => v.patientUid === 'p-ana').length;
    assert.ok(ofAna >= 3); // nutri-1, nutri-ordem e nutri-2
    const before = memory().length;
    assert.equal(await call('erasePatientMemory', 'p-ana'), ofAna);
    assert.equal(memory((v) => v.patientUid === 'p-ana' || v.patientName === 'Ana Souza').length, 0);
    assert.equal(memory().length, before - ofAna);
    assert.equal(store.has('aliMemory/n2-pref'), true);
    assert.equal(store.has('aliMemory/o-b'), true);
    assert.equal(await call('erasePatientMemory', 'p-ana'), 0);
    for (const uid of ['', 'a/b', undefined, 42]) assert.equal(await call('erasePatientMemory', uid), 0);
    assert.equal(memory().length, before - ofAna);
  });

  console.log(`${count} verificações da memória da Ali da nutricionista passaram. Nenhum serviço externo foi chamado.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
