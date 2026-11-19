// Testa a ficha clínica do paciente (lib/clinical-profile.ts): limpeza dos dados, leitura e mudanças por voz,
// gravação pela tela, apoio ao plano, LGPD e isolamento entre nutricionistas, com o Firestore simulado.
// Nenhum serviço externo é chamado.
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createFirestore, loadLib } = require('./fakes.cjs');

const { store, db } = createFirestore();
const context = loadLib(['ali-settings.ts', 'clinical-profile.ts'], {});
const run = (code) => vm.runInContext(code, context);
const plain = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
/** Chama uma função da lib com os argumentos dados e devolve o resultado em objetos comuns. */
const call = async (fn, ...args) => { context.args = args; return plain(await run(`${fn}(...args)`)); };

const NUTRI = 'nutri-1';
const OTHER = 'nutri-2';
const NOW = new Date('2026-10-13T13:00:00Z');
const ANA = { uid: 'p-ana', name: 'Ana Souza' };
const JOAO = { uid: 'p-joao', name: 'João Pereira' };
const MARCOS = { uid: 'p-marcos', name: 'Marcos Lima' };
const update = (input, patient = ANA, nutri = NUTRI) => call('updateClinicalProfile', db, nutri, patient, input, 'ali', NOW);
const docOf = (nutri, patientUid) => store.get(`clinicalProfiles/${nutri}_${patientUid}`);
/** Mensagem do erro da gravação pela tela (o erro nasce no contexto isolado; aqui só interessa o texto). */
const saveError = (patientUid) => call('saveClinicalProfile', db, NUTRI, patientUid, { allergies: ['uva'] }, 'app', NOW).then(() => 'gravou', (error) => String(error.message));

let count = 0;
async function check(name, fn) { await fn(); count++; }

(async () => {
  store.set('patients/p-ana', { name: 'Ana Souza', nutritionistId: NUTRI });
  store.set('patients/p-joao', { name: 'João Pereira', nutritionistId: NUTRI });
  store.set('patients/p-bia', { name: 'Bia Rocha', nutritionistId: NUTRI });
  store.set('patients/p-marcos', { name: 'Marcos Lima', nutritionistId: OTHER });

  await check('constantes: coleção, as 8 listas com nomes em português e os limites', async () => {
    assert.equal(run('CLINICAL_COLLECTION'), 'clinicalProfiles');
    const lists = plain(run('CLINICAL_LISTS'));
    assert.deepEqual(lists.map((l) => l.key), ['allergies', 'intolerances', 'restrictions', 'dislikes', 'preferences', 'conditions', 'medications', 'supplements']);
    assert.deepEqual(lists.map((l) => l.label), ['alergias', 'intolerâncias', 'restrições alimentares', 'não gosta de', 'preferências', 'condições de saúde', 'medicamentos', 'suplementos']);
    assert.ok(lists.every((l) => typeof l.singular === 'string' && l.singular));
    assert.deepEqual(plain(run('CLINICAL_LIMITS')), { item: 80, perList: 20, notes: 1000 });
  });

  await check('limpeza: itens de 2 a 80 caracteres, sem repetir, até 20 por lista; sexo e atividade inválidos viram null', async () => {
    const empty = await call('emptyClinicalProfile');
    assert.deepEqual(empty, { sex: null, activity: null, allergies: [], intolerances: [], restrictions: [], dislikes: [], preferences: [], conditions: [], medications: [], supplements: [], notes: '', updatedAt: null, updatedBy: null });
    const s = await call('sanitizeClinicalProfile', {
      sex: 'X', activity: 'correndo', allergies: ['  Amendoim. ', 'amendoim', 'AMENDOIM', 'a', 'x'.repeat(81), 42, null, 'Camarão', 'camarao', '{{nome}} ovo\n'],
      intolerances: 'lactose', notes: 'n'.repeat(1200), updatedAt: 'ontem', updatedBy: 'hacker', nutritionistId: 'nutri-2', extra: 'campo estranho',
    });
    assert.deepEqual(s.allergies, ['Amendoim', 'Camarão', 'nome ovo']);
    assert.deepEqual(s.intolerances, []);
    assert.equal(s.sex, null);
    assert.equal(s.activity, null);
    assert.equal(s.notes.length, 1000);
    assert.equal(s.updatedAt, null);
    assert.equal(s.updatedBy, null);
    assert.ok(!('extra' in s) && !('nutritionistId' in s));
    const many = Array.from({ length: 30 }, (_, i) => `remédio ${i + 1}`);
    assert.equal((await call('sanitizeClinicalProfile', { medications: many })).medications.length, 20);
    assert.deepEqual(await call('sanitizeClinicalProfile', 'texto'), empty);
    assert.deepEqual(await call('sanitizeClinicalProfile', null), empty);
    assert.deepEqual(await call('sanitizeClinicalProfile', [1, 2]), empty);
    const ok = await call('sanitizeClinicalProfile', { sex: 'F', activity: 'muito_intenso', updatedAt: '2026-10-01T10:00:00.000Z', updatedBy: 'app' });
    assert.equal(ok.sex, 'F');
    assert.equal(ok.activity, 'muito_intenso');
    assert.equal(ok.updatedAt, '2026-10-01T10:00:00.000Z');
    assert.equal(ok.updatedBy, 'app');
    assert.equal((await call('sanitizeClinicalProfile', { sex: 'masculino', activity: 'Moderada' })).activity, 'moderado');
    assert.equal((await call('sanitizeClinicalProfile', { activity: 'constructor', sex: 'toString' })).activity, null);
  });

  await check('ficha vazia: a Ali diz que está vazia e como preencher', async () => {
    const result = await call('getClinicalProfile', db, NUTRI, ANA);
    assert.equal(result.ok, true);
    assert.equal(result.speech, 'A ficha clínica de Ana Souza ainda está vazia. É só me dizer, por exemplo: anote que Ana tem alergia a amendoim.');
    assert.deepEqual(result.profile.allergies, []);
  });

  await check('incluir alergias: um texto vira vários itens, grava o dono, a hora e de onde veio', async () => {
    const result = await update({ field: 'alergias', add: 'amendoim, camarão e leite' });
    assert.equal(result.ok, true);
    assert.equal(result.speech, 'Incluí amendoim, camarão e leite nas alergias de Ana Souza.');
    assert.deepEqual(result.profile.allergies, ['amendoim', 'camarão', 'leite']);
    const doc = docOf(NUTRI, 'p-ana');
    assert.equal(doc.nutritionistId, NUTRI);
    assert.equal(doc.patientUid, 'p-ana');
    assert.deepEqual(doc.allergies, ['amendoim', 'camarão', 'leite']);
    assert.equal(doc.updatedAt, NOW.toISOString());
    assert.equal(doc.updatedBy, 'ali');
  });

  await check('o que já estava não se repete', async () => {
    const same = await update({ field: 'allergies', add: 'Amendoim' });
    assert.equal(same.ok, true);
    assert.equal(same.speech, 'Amendoim já estava nas alergias de Ana Souza.');
    assert.deepEqual(docOf(NUTRI, 'p-ana').allergies, ['amendoim', 'camarão', 'leite']);
    const mixed = await update({ field: 'alergia', add: ['AMENDOIM', 'ovo'] });
    assert.equal(mixed.speech, 'Incluí ovo nas alergias de Ana Souza. AMENDOIM já estava na lista.');
    assert.deepEqual(docOf(NUTRI, 'p-ana').allergies, ['amendoim', 'camarão', 'leite', 'ovo']);
  });

  await check('nomes das partes da ficha: com ou sem acento, singular ou plural', async () => {
    const cases = [
      ['Intolerância', 'lactose', 'intolerances', 'Incluí lactose nas intolerâncias de Ana Souza.'],
      ['restrições', 'vegetariana', 'restrictions', 'Incluí vegetariana nas restrições alimentares de Ana Souza.'],
      ['não gosta', 'jiló', 'dislikes', 'Incluí jiló nas aversões de Ana Souza.'],
      ['aversao', 'fígado', 'dislikes', 'Incluí fígado nas aversões de Ana Souza.'],
      ['preferencias', 'comida caseira', 'preferences', 'Incluí comida caseira nas preferências de Ana Souza.'],
      ['doenças', 'diabetes tipo 2', 'conditions', 'Incluí diabetes tipo 2 nas condições de saúde de Ana Souza.'],
      ['diagnóstico', 'hipertensão', 'conditions', 'Incluí hipertensão nas condições de saúde de Ana Souza.'],
      ['remédios', ['metformina'], 'medications', 'Incluí metformina nos medicamentos de Ana Souza.'],
      ['as condições de saúde', 'hipotireoidismo', 'conditions', 'Incluí hipotireoidismo nas condições de saúde de Ana Souza.'],
      ['suplemento', 'vitamina D', 'supplements', 'Incluí vitamina D nos suplementos de Ana Souza.'],
    ];
    for (const [field, add, key, speech] of cases) {
      const result = await update({ field, add });
      assert.equal(result.speech, speech, field);
      assert.ok(result.profile[key].includes(Array.isArray(add) ? add[0] : add), field);
    }
    // Sem add, o value também serve para incluir.
    assert.equal((await update({ field: 'medicamento', value: 'losartana' })).speech, 'Incluí losartana nos medicamentos de Ana Souza.');
  });

  await check('sexo e nível de atividade: palavras faladas, valor inválido pergunta de novo, e dá para tirar', async () => {
    const sex = await update({ field: 'sexo', value: 'mulher' });
    assert.equal(sex.speech, 'Anotei na ficha de Ana Souza: sexo feminino.');
    assert.equal(docOf(NUTRI, 'p-ana').sex, 'F');
    assert.equal((await update({ field: 'sex', value: 'Masculino' })).profile.sex, 'M');
    const wrong = await update({ field: 'sexo', value: 'talvez' });
    assert.equal(wrong.status, 422);
    assert.match(wrong.speech, /feminino ou masculino/);
    assert.equal((await update({ field: 'sexo', value: 'feminino' })).profile.sex, 'F');

    const activity = await update({ field: 'nível de atividade', value: 'moderada' });
    assert.equal(activity.speech, 'Anotei na ficha de Ana Souza: nível de atividade moderado.');
    assert.equal(docOf(NUTRI, 'p-ana').activity, 'moderado');
    assert.equal((await update({ field: 'atividade', value: 'muito intenso' })).profile.activity, 'muito_intenso');
    assert.equal((await update({ field: 'activity', value: 'Sedentária' })).profile.activity, 'sedentario');
    const bad = await update({ field: 'atividade', value: 'atleta olímpico' });
    assert.equal(bad.status, 422);
    assert.match(bad.speech, /sedentário, leve, moderado, intenso ou muito intenso/);
    const cleared = await update({ field: 'atividade', remove: true });
    assert.equal(cleared.speech, 'Tirei o nível de atividade da ficha de Ana Souza.');
    assert.equal(docOf(NUTRI, 'p-ana').activity, null);
    await update({ field: 'atividade', value: 'moderado' });
  });

  await check('observações: o value troca o texto; mais de mil caracteres é recusado; dá para apagar', async () => {
    const notes = await update({ field: 'observações', value: 'Trabalha em turnos e almoça fora.' });
    assert.equal(notes.speech, 'Observações da ficha de Ana Souza atualizadas: Trabalha em turnos e almoça fora.');
    assert.equal(docOf(NUTRI, 'p-ana').notes, 'Trabalha em turnos e almoça fora.');
    const long = await update({ field: 'notes', value: 'a'.repeat(1001) });
    assert.equal(long.status, 422);
    assert.equal(docOf(NUTRI, 'p-ana').notes, 'Trabalha em turnos e almoça fora.');
    assert.equal((await update({ field: 'obs', value: 42 })).status, 422);
    assert.equal((await update({ field: 'observacao', remove: true })).speech, 'Apaguei as observações da ficha de Ana Souza.');
    assert.equal(docOf(NUTRI, 'p-ana').notes, '');
    await update({ field: 'observacoes', value: 'Trabalha em turnos.' });
  });

  await check('parte da ficha desconhecida ou faltando: 422 dizendo o que dá para anotar', async () => {
    const unknown = await update({ field: 'tipo sanguíneo', add: 'O+' });
    assert.equal(unknown.status, 422);
    assert.match(unknown.speech, /^Não conheço essa parte da ficha\. Posso anotar alergias, intolerâncias, restrições alimentares, aversões, preferências, condições de saúde, medicamentos, suplementos, sexo, nível de atividade e observações\.$/);
    const missing = await update({ add: 'amendoim' });
    assert.equal(missing.status, 422);
    assert.match(missing.speech, /^Em qual parte da ficha\?/);
    assert.equal((await update(undefined)).status, 422);
    const nothing = await update({ field: 'alergias' });
    assert.equal(nothing.status, 422);
    assert.equal(nothing.speech, 'O que você quer incluir nas alergias de Ana Souza?');
    assert.equal((await update({ field: 'alergias', add: [null, 7, ' '] })).status, 422);
  });

  await check('tirar itens: sem acento, por palavras, vários de uma vez; item que não existe ou ambíguo pergunta', async () => {
    const removed = await update({ field: 'alergias', remove: 'camarao' });
    assert.equal(removed.speech, 'Tirei camarão das alergias de Ana Souza.');
    assert.deepEqual(docOf(NUTRI, 'p-ana').allergies, ['amendoim', 'leite', 'ovo']);
    const missing = await update({ field: 'alergias', remove: 'soja' });
    assert.equal(missing.status, 404);
    assert.equal(missing.speech, 'Não achei soja nas alergias de Ana Souza. A lista tem: amendoim, leite e ovo. Qual você quer tirar?');
    const both = await update({ field: 'alergias', remove: 'leite e ovo' });
    assert.equal(both.speech, 'Tirei leite e ovo das alergias de Ana Souza.');
    assert.deepEqual(docOf(NUTRI, 'p-ana').allergies, ['amendoim']);

    await update({ field: 'intolerancias', add: ['leite de vaca', 'leite de cabra'] });
    const ambiguous = await update({ field: 'intolerancias', remove: 'leite' });
    assert.equal(ambiguous.status, 409);
    assert.match(ambiguous.speech, /leite de vaca e leite de cabra\. Qual deles\?$/);
    assert.equal((await update({ field: 'intolerancias', remove: 'leite de cabra' })).speech, 'Tirei leite de cabra das intolerâncias de Ana Souza.');
    assert.equal((await update({ field: 'intolerancias', remove: 'de vaca' })).speech, 'Tirei leite de vaca das intolerâncias de Ana Souza.');
    // Tirar e incluir na mesma fala.
    const swap = await update({ field: 'medicamentos', remove: 'losartana', add: 'enalapril' });
    assert.equal(swap.speech, 'Tirei losartana dos medicamentos de Ana Souza. Incluí enalapril nos medicamentos de Ana Souza.');
    assert.deepEqual(docOf(NUTRI, 'p-ana').medications, ['metformina', 'enalapril']);
    const emptyList = await update({ field: 'suplementos', remove: 'creatina' }, JOAO);
    assert.equal(emptyList.status, 404);
    assert.equal(emptyList.speech, 'Não há nada anotado nos suplementos de João Pereira.');
  });

  await check('limites: até 20 itens por lista e até 80 caracteres por item', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `alimento ${i + 1}`);
    assert.equal((await update({ field: 'aversões', add: twenty }, JOAO)).ok, true);
    const full = await update({ field: 'aversões', add: 'jiló' }, JOAO);
    assert.equal(full.status, 422);
    assert.match(full.speech, /^Não cabe mais nada nas aversões de João Pereira: o limite é de 20 itens por lista\./);
    assert.equal(docOf(NUTRI, 'p-joao').dislikes.length, 20);
    await update({ field: 'aversões', remove: 'alimento 20' }, JOAO);
    await update({ field: 'aversões', remove: 'alimento 19' }, JOAO);
    const room = await update({ field: 'aversões', add: 'jiló, quiabo e fígado' }, JOAO);
    assert.equal(room.status, 422);
    assert.match(room.speech, /^Só cabem mais 2 itens nas aversões de João Pereira/);
    const long = await update({ field: 'alergias', add: 'x'.repeat(81) }, JOAO);
    assert.equal(long.status, 422);
    assert.match(long.speech, /longo demais/);
    assert.deepEqual(docOf(NUTRI, 'p-joao').allergies, undefined);
  });

  await check('leitura da ficha: só o que está preenchido, na ordem, e a fala não passa do tamanho', async () => {
    store.delete(`clinicalProfiles/${NUTRI}_p-joao`);
    await call('saveClinicalProfile', db, NUTRI, 'p-joao', { allergies: ['amendoim', 'camarão'], intolerances: ['lactose'], medications: ['metformina'], sex: 'M', activity: 'leve', notes: 'Trabalha em turnos.' }, 'app', NOW);
    const result = await call('getClinicalProfile', db, NUTRI, JOAO);
    assert.equal(result.speech, 'Ficha de João Pereira: alergia a amendoim e camarão. Intolerância a lactose. Medicamentos: metformina. Sexo masculino. Nível de atividade leve. Observações: Trabalha em turnos.');
    assert.equal(result.profile.updatedBy, 'app');

    // Começando por uma lista com dois-pontos, a abertura fecha antes.
    await call('saveClinicalProfile', db, NUTRI, 'p-bia', { medications: ['levotiroxina'] }, 'app', NOW);
    assert.equal((await call('getClinicalProfile', db, NUTRI, { uid: 'p-bia', name: 'Bia Rocha' })).speech, 'Ficha de Bia Rocha. Medicamentos: levotiroxina.');

    // Ficha cheia: fala no máximo cinco itens por lista e manda o resto para a tela.
    const fullList = (word) => Array.from({ length: 20 }, (_, i) => `${word} número ${i + 1} com nome comprido`);
    const big = {};
    for (const key of ['allergies', 'intolerances', 'restrictions', 'dislikes', 'preferences', 'conditions', 'medications', 'supplements']) big[key] = fullList(key);
    await call('saveClinicalProfile', db, NUTRI, 'p-bia', { ...big, notes: 'o'.repeat(1000) }, 'app', NOW);
    const long = await call('getClinicalProfile', db, NUTRI, { uid: 'p-bia', name: 'Bia Rocha' });
    assert.ok(long.speech.length <= 600, `fala com ${long.speech.length} caracteres`);
    assert.match(long.speech, /^Ficha de Bia Rocha: alergia a allergies número 1 com nome comprido, .* e mais 15\./);
    assert.match(long.speech, /O resto da ficha está na tela do paciente\.$/);
    assert.equal(long.profile.allergies.length, 20);
  });

  await check('apoio ao plano: contexto em português sem o nome, frase de alerta e termos para conferir', async () => {
    const profile = await call('loadClinicalProfile', db, NUTRI, 'p-ana');
    context.profile = profile;
    const ctx = plain(run('clinicalContextForPlan(profile)'));
    assert.deepEqual(Object.keys(ctx), ['alergias', 'intolerancias', 'restricoes', 'naoGosta', 'preferencias', 'condicoesDeSaude', 'medicamentos', 'suplementos', 'sexo', 'nivelDeAtividade', 'observacoes']);
    assert.deepEqual(ctx.alergias, ['amendoim']);
    assert.equal(ctx.sexo, 'feminino');
    assert.equal(ctx.nivelDeAtividade, 'moderado');
    assert.ok(!JSON.stringify(ctx).includes('Ana'));
    assert.ok(!('updatedAt' in ctx) && !('nutritionistId' in ctx));
    assert.equal(run('clinicalContextForPlan(emptyClinicalProfile())'), null);

    assert.equal(run('clinicalAlertLine(profile)'), 'Atenção na ficha: alergia a amendoim; intolerância a lactose; restrição alimentar: vegetariana.');
    assert.equal(run('clinicalAlertLine(emptyClinicalProfile())'), '');
    assert.equal(run("clinicalAlertLine({ ...emptyClinicalProfile(), medications: ['metformina'] })"), '');

    const terms = plain(run('clinicalAvoidTerms(profile)'));
    // "vegetariana" é um jeito de comer, não um ingrediente: não entra na procura do plano (daria alarme falso).
    assert.deepEqual(terms, [
      { label: 'alergia', term: 'amendoim' },
      { label: 'intolerância', term: 'lactose' },
      { label: 'não gosta', term: 'jiló' },
      { label: 'não gosta', term: 'fígado' },
    ]);
    assert.deepEqual(plain(run('clinicalAvoidTerms(emptyClinicalProfile())')), []);
    // Digitado na tela num item só: cada alimento vira um termo, e o que está entre parênteses fica de fora.
    const typed = plain(run("clinicalAvoidTerms({ ...emptyClinicalProfile(), allergies: ['amendoim, camarão', 'castanhas (anafilaxia)'], intolerances: ['leite e derivados'], restrictions: ['sem glúten', 'vegano'] })"));
    assert.deepEqual(typed, [
      { label: 'alergia', term: 'amendoim' },
      { label: 'alergia', term: 'camarão' },
      { label: 'alergia', term: 'castanhas' },
      { label: 'intolerância', term: 'leite' },
      { label: 'intolerância', term: 'derivados' },
      { label: 'restrição', term: 'sem glúten' },
    ]);
  });

  await check('gravação pela tela: troca a ficha inteira, marca app e limpa o que chegou', async () => {
    const saved = await call('saveClinicalProfile', db, NUTRI, 'p-bia', { allergies: ['Soja', 'soja', ''], sex: 'nada', notes: '  Gestante.  ' }, 'app', NOW);
    assert.deepEqual(saved.allergies, ['Soja']);
    assert.deepEqual(saved.medications, []);
    assert.equal(saved.sex, null);
    assert.equal(saved.notes, 'Gestante.');
    assert.equal(saved.updatedBy, 'app');
    assert.equal(saved.updatedAt, NOW.toISOString());
    const doc = docOf(NUTRI, 'p-bia');
    assert.equal(doc.nutritionistId, NUTRI);
    assert.equal(doc.patientUid, 'p-bia');
    assert.deepEqual(doc.medications, []);
    assert.deepEqual(await call('loadClinicalProfile', db, NUTRI, 'p-bia'), saved);
  });

  await check('isolamento: uma nutricionista não lê nem muda a ficha de outra', async () => {
    store.set(`clinicalProfiles/${OTHER}_p-marcos`, { nutritionistId: OTHER, patientUid: 'p-marcos', allergies: ['glúten'], notes: 'Segredo da outra' });
    store.set(`clinicalProfiles/${OTHER}_p-ana`, { nutritionistId: OTHER, patientUid: 'p-ana', allergies: ['soja'], notes: 'Ficha antiga da outra' });
    // nutri-1 lendo: nunca vê o que é da nutri-2.
    const ana = await call('getClinicalProfile', db, NUTRI, ANA);
    assert.ok(!ana.speech.includes('soja') && !JSON.stringify(ana).includes('Ficha antiga'));
    assert.deepEqual((await call('loadClinicalProfile', db, NUTRI, 'p-marcos')).allergies, []);
    // Documento com o id dela, mas gravado com outro dono: conta como não existente e não é sobrescrito.
    store.set(`clinicalProfiles/${NUTRI}_p-joao`, { nutritionistId: OTHER, patientUid: 'p-joao', allergies: ['kiwi'] });
    assert.deepEqual((await call('loadClinicalProfile', db, NUTRI, 'p-joao')).allergies, []);
    const blocked = await update({ field: 'alergias', add: 'uva' }, JOAO);
    assert.equal(blocked.status, 409);
    assert.deepEqual(docOf(NUTRI, 'p-joao').allergies, ['kiwi']);
    assert.match(await saveError('p-joao'), /outra conta/);
    assert.deepEqual(docOf(NUTRI, 'p-joao').allergies, ['kiwi']);
    store.delete(`clinicalProfiles/${NUTRI}_p-joao`);
    // Paciente da nutri-2: nutri-1 não cria ficha para ele, nem pela voz nem pela tela.
    const stranger = await update({ field: 'alergias', add: 'uva' }, MARCOS);
    assert.equal(stranger.status, 404);
    assert.equal(docOf(NUTRI, 'p-marcos'), undefined);
    assert.match(await saveError('p-marcos'), /não encontrado/);
    assert.equal(docOf(NUTRI, 'p-marcos'), undefined);
    assert.deepEqual(store.get(`clinicalProfiles/${OTHER}_p-marcos`).allergies, ['glúten']);
    // Paciente que não existe e ids estranhos.
    assert.equal((await update({ field: 'alergias', add: 'uva' }, { uid: 'p-nao-existe', name: 'Fulano' })).status, 404);
    assert.equal((await update({ field: 'alergias', add: 'uva' }, { uid: 'patients/p-ana', name: 'Ana' })).status, 404);
    assert.equal((await call('getClinicalProfile', db, NUTRI, { uid: '', name: 'Ninguém' })).status, 404);
    assert.deepEqual(await call('loadClinicalProfile', db, NUTRI, '../p-ana'), await call('emptyClinicalProfile'));
  });

  await check('dados estranhos no banco não derrubam a leitura', async () => {
    store.set(`clinicalProfiles/${NUTRI}_p-bia`, { nutritionistId: NUTRI, patientUid: 'p-bia', allergies: 'amendoim', intolerances: [{ nome: 'x' }, 'glúten'], sex: 5, activity: ['leve'], notes: { texto: 'oi' }, updatedAt: 12345, updatedBy: 'ali' });
    const result = await call('getClinicalProfile', db, NUTRI, { uid: 'p-bia', name: '' });
    assert.equal(result.ok, true);
    assert.equal(result.speech, 'Ficha do paciente: intolerância a glúten.');
    assert.deepEqual(result.profile.allergies, []);
    assert.equal(result.profile.notes, '');
    assert.equal(result.profile.updatedAt, null);
    // E a mudança por voz grava a lista já limpa.
    await update({ field: 'intolerância', add: 'lactose' }, { uid: 'p-bia', name: 'Bia Rocha' });
    assert.deepEqual(docOf(NUTRI, 'p-bia').intolerances, ['glúten', 'lactose']);
  });

  await check('LGPD: exporta as fichas do paciente sem dizer de quem é a conta e apaga todas', async () => {
    const exported = await call('exportClinicalProfiles', db, 'p-ana');
    assert.equal(exported.length, 2);
    assert.ok(exported.every((item) => !('nutritionistId' in item) && !('patientUid' in item)));
    const mine = exported.find((item) => item.alergias.includes('amendoim'));
    assert.deepEqual(Object.keys(mine), ['sexo', 'nivelDeAtividade', 'alergias', 'intolerancias', 'restricoes', 'naoGosta', 'preferencias', 'condicoesDeSaude', 'medicamentos', 'suplementos', 'observacoes', 'atualizadaEm', 'atualizadaPor']);
    assert.equal(mine.sexo, 'feminino');
    assert.equal(mine.atualizadaPor, 'nutricionista, pela Ali');
    assert.ok(!JSON.stringify(exported).includes(NUTRI) && !JSON.stringify(exported).includes(OTHER));
    assert.deepEqual(await call('exportClinicalProfiles', db, ''), []);

    assert.equal(await call('eraseClinicalProfiles', db, 'p-ana'), 2);
    assert.equal(docOf(NUTRI, 'p-ana'), undefined);
    assert.equal(docOf(OTHER, 'p-ana'), undefined);
    assert.ok(docOf(NUTRI, 'p-bia') && docOf(OTHER, 'p-marcos'));
    assert.equal(await call('eraseClinicalProfiles', db, 'p-ana'), 0);
    assert.equal(await call('eraseClinicalProfiles', db, 'a/b'), 0);
  });

  console.log(count + ' verificações da ficha clínica passaram. Nenhum serviço externo foi chamado.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
