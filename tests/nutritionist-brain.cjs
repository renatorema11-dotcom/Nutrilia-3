// Testa o segundo cérebro da Ali (lib/nutritionist-brain.ts): contas com os dados do prontuário e da ficha, conferência
// do plano contra a ficha, contexto do rascunho de plano e a busca nos registros. Firestore simulado; nada externo é chamado.
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createFirestore, loadLib } = require('./fakes.cjs');

const { store, db } = createFirestore();
const context = loadLib(['ali-settings.ts', 'consultation-notes.ts', 'clinical-profile.ts', 'ali-memory.ts', 'taco-foods.ts', 'food-table.ts', 'plan-nutrition.ts', 'nutrition-calc.ts', 'nutritionist-brain.ts'], {});
context.db = db;
const run = (code) => vm.runInContext(code, context);
const call = (code, vars = {}) => { Object.assign(context, vars); return run(code); };
const plain = (value) => JSON.parse(JSON.stringify(value));
const NUTRI = 'nutri-1';
const ANA = { uid: 'p-ana', name: 'Ana Souza' };
let count = 0;
async function check(name, fn) { await fn(); count++; }

(async () => {
  store.set('patients/p-ana', {
    name: 'Ana Souza', nutritionistId: NUTRI, objective: 'Emagrecimento', age: 34, weight: 80, height: 165,
    measurements: [{ date: '2026-09-01', weight: 78, height: 165 }, { date: '2026-11-10', weight: 72.4 }],
    currentPlan: { status: 'approved', days: [{ name: 'Todos os dias', meals: [{ time: '08:00', name: 'Café', items: ['2 ovos mexidos', '1 fatia de pão integral'], foods: [{ taco: 488, grams: 100 }, { taco: 53, grams: 30 }] }] }] },
    pendingPlan: { status: 'draft', days: [{ name: 'Todos os dias', meals: [{ time: '15:00', name: 'Lanche', items: ['30 g de amendoim torrado'], foods: [null] }] }] },
  });
  store.set('patients/p-joao', { name: 'João Pereira', nutritionistId: NUTRI, objective: 'Controle da glicemia', age: 52 });
  store.set('patients/p-marcos', { name: 'Marcos de Outra', nutritionistId: 'nutri-2', objective: 'Diabetes', age: 40, weight: 90, height: 180 });
  store.set('clinicalProfiles/nutri-1_p-ana', { nutritionistId: NUTRI, patientUid: 'p-ana', sex: 'F', activity: 'leve', allergies: ['amendoim'], intolerances: ['lactose'] });
  store.set('clinicalProfiles/nutri-1_p-joao', { nutritionistId: NUTRI, patientUid: 'p-joao', conditions: ['diabetes tipo 2'], medications: ['metformina'] });
  store.set('clinicalProfiles/nutri-2_p-marcos', { nutritionistId: 'nutri-2', patientUid: 'p-marcos', conditions: ['diabetes tipo 1'], intolerances: ['lactose'] });
  store.set('consultationNotes/n1', { nutritionistId: NUTRI, patientUid: 'p-joao', text: 'Relatou insônia e muita fome à noite; combinamos jantar mais cedo.', createdAt: '2026-11-05T13:00:00.000Z', source: 'app' });
  store.set('consultationNotes/n2', { nutritionistId: 'nutri-2', patientUid: 'p-marcos', text: 'Insônia também, de outra nutricionista.', createdAt: '2026-11-05T13:00:00.000Z', source: 'app' });
  store.set('aliMemory/m1', { nutritionistId: NUTRI, kind: 'preference', text: 'Prefiro planos com 5 refeições por dia', source: 'ali', createdAt: '2026-11-01T10:00:00.000Z' });
  store.set('aliMemory/m2', { nutritionistId: NUTRI, kind: 'followup', text: 'Pedir hemoglobina glicada', patientUid: 'p-joao', patientName: 'João Pereira', status: 'open', dueDate: null, createdAt: '2026-11-02T10:00:00.000Z', source: 'ali' });
  store.set('aliMemory/m3', { nutritionistId: 'nutri-2', kind: 'preference', text: 'Planos de outra nutricionista', source: 'ali', createdAt: '2026-11-01T10:00:00.000Z' });

  await check('gasto de energia com o nome: usa a pesagem mais recente, a altura, a idade, o sexo e a atividade da ficha', async () => {
    const result = plain(await call("energyNeedsFor(db, 'nutri-1', patient, {})", { patient: ANA }));
    assert.equal(result.ok, true);
    assert.equal(result.inputs.weight, 72.4);
    assert.equal(result.inputs.height, 165);
    assert.equal(result.inputs.age, 34);
    assert.equal(result.inputs.sex, 'F');
    assert.equal(result.inputs.activity, 'leve');
    // Mifflin-St Jeor, mulher: 10×72,4 + 6,25×165 − 5×34 − 161 = 1424,25; × 1,375 = 1958.
    assert.equal(result.bmr, 1424);
    assert.equal(result.tee, 1958);
    assert.match(result.speech, /^Usei do prontuário de Ana Souza: peso de 72,4 quilos, altura de 165 centímetros, 34 anos, sexo feminino e nível de atividade leve\./);
    assert.deepEqual(result.fromRecord.length, 5);
  });

  await check('o que ela disser vale mais que o prontuário', async () => {
    const result = plain(await call("energyNeedsFor(db, 'nutri-1', patient, { weight: 70, activity: 'moderado' })", { patient: ANA }));
    assert.equal(result.inputs.weight, 70);
    assert.equal(result.inputs.activity, 'moderado');
    assert.ok(!result.speech.includes('peso de 72,4'));
  });

  await check('sem paciente: só os números ditos; faltando o sexo, a conta pergunta', async () => {
    const asks = plain(await call("energyNeedsFor(db, 'nutri-1', null, { weight: 70, height: 170, age: 30 })"));
    assert.equal(asks.ok, false);
    assert.equal(asks.status, 422);
    const done = plain(await call("energyNeedsFor(db, 'nutri-1', null, { weight: 70, height: 170, age: 30, sex: 'M' })"));
    assert.equal(done.ok, true);
    assert.equal(done.fromRecord, undefined);
  });

  await check('paciente de outra nutricionista não é lido, mesmo com o uid certo', async () => {
    const result = plain(await call("energyNeedsFor(db, 'nutri-1', patient, {})", { patient: { uid: 'p-marcos', name: 'Marcos' } }));
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.ok(!JSON.stringify(result).includes('90'));
  });

  await check('IMC e macros com os dados do prontuário', async () => {
    const bmi = plain(await call("bodyMetricsFor(db, 'nutri-1', patient, {})", { patient: ANA }));
    assert.equal(bmi.ok, true);
    assert.equal(bmi.bmi, 26.6);
    const macros = plain(await call("macrosFor(db, 'nutri-1', patient, { kcal: 1800 })", { patient: ANA }));
    assert.equal(macros.ok, true);
    assert.equal(macros.protein.grams, Math.round(72.4 * 1.6));
  });

  await check('conferir o plano: por padrão o rascunho, com o alerta da alergia da ficha', async () => {
    const result = plain(await call("checkPlanFor(db, 'nutri-1', patient, {})", { patient: ANA }));
    assert.equal(result.ok, true);
    assert.ok(result.flags.some((flag) => flag.term === 'amendoim' && flag.label === 'alergia'));
    assert.match(result.speech, /amendoim/);
  });

  await check('conferir o plano aprovado, com meta de calorias; meta fora da faixa é recusada', async () => {
    const result = plain(await call("checkPlanFor(db, 'nutri-1', patient, { which: 'aprovado', targetKcal: '1800' })", { patient: ANA }));
    assert.equal(result.ok, true);
    assert.equal(result.flags.length, 0);
    assert.equal(result.target.kcal, 1800);
    assert.equal((await call("checkPlanFor(db, 'nutri-1', patient, { targetKcal: 50 })", { patient: ANA })).status, 422);
    const none = plain(await call("checkPlanFor(db, 'nutri-1', patient, {})", { patient: { uid: 'p-joao', name: 'João Pereira' } }));
    assert.equal(none.status, 404);
  });

  await check('contexto do rascunho: ficha clínica sem o nome e as preferências só dela', async () => {
    const result = plain(await call("planBrainContext(db, 'nutri-1', 'p-ana')"));
    assert.deepEqual(result.fichaClinica.alergias, ['amendoim']);
    assert.match(result.preferenciasDaNutricionista, /5 refeições/);
    assert.ok(!JSON.stringify(result).includes('Ana') && !JSON.stringify(result).includes('outra nutricionista'));
    assert.deepEqual(plain(await call("planBrainContext(db, 'nutri-3', 'p-ana')")), {});
  });

  await check('contexto do rascunho: o nome do paciente escrito nas observações não vai para a IA', async () => {
    const before = store.get('clinicalProfiles/nutri-1_p-ana');
    store.set('clinicalProfiles/nutri-1_p-ana', { ...before, notes: 'Ana Souza relata refluxo à noite; a ana prefere jantar cedo. Banana liberada.' });
    const result = plain(await call("planBrainContext(db, 'nutri-1', 'p-ana')"));
    assert.equal(result.fichaClinica.observacoes, 'o paciente relata refluxo à noite; a o paciente prefere jantar cedo. Banana liberada.');
    store.set('clinicalProfiles/nutri-1_p-ana', before);
  });

  await check('busca: pendência de paciente que saiu da lista dela não aparece', async () => {
    store.set('aliMemory/m9', { nutritionistId: NUTRI, kind: 'followup', text: 'Pedir exame de ferritina', patientUid: 'p-saiu', patientName: 'Paciente Que Saiu', status: 'open', dueDate: null, createdAt: '2026-11-02T10:00:00.000Z', source: 'ali' });
    const result = plain(await call("searchRecords(db, 'nutri-1', { query: 'ferritina' }, 'America/Sao_Paulo')"));
    assert.equal(result.total, 0);
    store.delete('aliMemory/m9');
  });

  await check('busca: fichas, anotações e pendências dela; nada de outra nutricionista', async () => {
    const lactose = plain(await call("searchRecords(db, 'nutri-1', { query: 'lactose' }, 'America/Sao_Paulo')"));
    assert.equal(lactose.total, 1);
    assert.equal(lactose.results[0].patientName, 'Ana Souza');
    assert.match(lactose.speech, /Na ficha de Ana Souza, intolerâncias: lactose\./);
    const insonia = plain(await call("searchRecords(db, 'nutri-1', { query: 'insonia' }, 'America/Sao_Paulo')"));
    assert.equal(insonia.total, 1);
    assert.equal(insonia.results[0].kind, 'anotacao');
    assert.match(insonia.speech, /5 de novembro/);
    const diabetes = plain(await call("searchRecords(db, 'nutri-1', { query: 'diabetes' }, 'America/Sao_Paulo')"));
    assert.ok(diabetes.results.every((hit) => hit.patientName !== 'Marcos de Outra'));
    assert.ok(!JSON.stringify(diabetes).includes('tipo 1'));
    const glicada = plain(await call("searchRecords(db, 'nutri-1', { query: 'hemoglobina' }, 'America/Sao_Paulo')"));
    assert.equal(glicada.results[0].kind, 'pendencia');
    const outra = plain(await call("searchRecords(db, 'nutri-1', { query: 'outra nutricionista' }, 'America/Sao_Paulo')"));
    assert.equal(outra.total, 0);
  });

  await check('busca: só palavras vazias pede outra palavra; nada achado explica que é por palavra', async () => {
    assert.equal((await call("searchRecords(db, 'nutri-1', { query: 'de quem' }, 'America/Sao_Paulo')")).status, 422);
    const nada = plain(await call("searchRecords(db, 'nutri-1', { query: 'celíaca' }, 'America/Sao_Paulo')"));
    assert.equal(nada.ok, true);
    assert.match(nada.speech, /busca é por palavra/);
  });

  console.log(`${count} verificações do segundo cérebro da Ali passaram. Nenhum serviço externo foi chamado.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
