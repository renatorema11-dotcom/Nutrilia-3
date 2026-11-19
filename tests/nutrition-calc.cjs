// Testa as calculadoras da Ali da nutricionista (lib/nutrition-calc.ts): gasto energético, IMC, divisão de macros e
// a conferência do plano pela TACO com a ficha clínica. Funções puras: não há banco nem serviço externo.
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { loadLib } = require('./fakes.cjs');

const context = loadLib(['ali-settings.ts', 'taco-foods.ts', 'food-table.ts', 'plan-nutrition.ts', 'nutrition-calc.ts'], {});
const run = (code) => vm.runInContext(code, context);
const plain = (value) => JSON.parse(JSON.stringify(value));
const call = (fn, ...args) => { context.args = args; return plain(run(`${fn}(...args)`)); };
const energy = (input) => call('energyNeeds', input);
const bmi = (input) => call('bodyMetrics', input);
const macros = (input) => call('macroSplit', input);
const check = (plan, options) => call('planCheck', plan, options);
const NOTE = 'É uma estimativa para apoiar a sua decisão.';
const PLAN_NOTE = 'É uma estimativa pela tabela TACO, para apoiar a sua decisão.';

let count = 0;
function test(name, fn) { fn(); count++; }

test('gasto energético: Mifflin-St Jeor é o padrão, com as contas certas para mulher e homem', () => {
  // Mulher: 10×70 + 6,25×165 − 5×35 − 161 = 1395,25; moderada (1,55) = 2162,6.
  const woman = energy({ weight: 70, height: 165, age: 35, sex: 'F', activity: 'moderado' });
  assert.equal(woman.ok, true);
  assert.deepEqual([woman.formula, woman.bmr, woman.tee, woman.factor], ['mifflin', 1395, 2163, 1.55]);
  assert.deepEqual(woman.inputs, { weight: 70, height: 165, age: 35, sex: 'F', activity: 'moderado' });
  assert.equal(woman.speech, 'Para uma mulher de 35 anos, com 70 quilos e 1,65 metro, pela fórmula de Mifflin-St Jeor, o gasto em repouso fica em cerca de 1.395 calorias por dia. '
    + 'Com atividade moderada, fator 1,55, o gasto total fica em cerca de 2.163 calorias por dia. ' + NOTE);
  // Homem: 10×80 + 6,25×180 − 5×40 + 5 = 1730; sem atividade dita, sedentário (1,2) = 2076.
  const man = energy({ weight: '80', height: '180 cm', age: '40 anos', sex: 'masculino' });
  assert.deepEqual([man.bmr, man.tee, man.inputs.activity, man.factor], [1730, 2076, 'sedentario', 1.2]);
  assert.match(man.speech, /^Para um homem de 40 anos, com 80 quilos e 1,80 metro,/);
  assert.ok(man.speech.endsWith(NOTE));
});

test('gasto energético: Harris-Benedict revisada (Roza e Shizgal) quando ela pedir', () => {
  // Homem: 88,362 + 13,397×80 + 4,799×180 − 5,677×40 = 1796,9.
  const man = energy({ weight: 80, height: 180, age: 40, sex: 'M', formula: 'Harris-Benedict' });
  assert.deepEqual([man.formula, man.bmr, man.tee], ['harris', 1797, 2156]);
  assert.match(man.speech, /fórmula de Harris-Benedict revisada/);
  // Mulher: 447,593 + 9,247×60 + 3,098×160 − 4,330×30 = 1368,2; muito intensa (1,9) = 2599,6.
  const woman = energy({ weight: 60, height: 160, age: 30, sex: 'mulher', activity: 'muito intensa', formula: 'harris' });
  assert.deepEqual([woman.bmr, woman.tee, woman.factor, woman.inputs.activity], [1368, 2600, 1.9, 'muito_intenso']);
  assert.match(woman.speech, /atividade muito intensa, fator 1,9,/);
});

test('gasto energético: fatores de atividade, apelidos e números falados com vírgula ou em metros', () => {
  const base = { weight: 70, height: 165, age: 35, sex: 'F' };
  const factors = { sedentario: 1.2, 'sedentária': 1.2, leve: 1.375, 'levemente ativa': 1.375, moderada: 1.55, intenso: 1.725, intensa: 1.725, muito_intenso: 1.9, 'Muito Intenso': 1.9 };
  for (const [activity, factor] of Object.entries(factors)) assert.equal(energy({ ...base, activity }).factor, factor, activity);
  assert.match(energy({ ...base, activity: 'leve' }).speech, /atividade leve, fator 1,375,/);
  const spoken = energy({ weight: '70,5', height: '1,65', age: 35, sex: 'Sexo feminino', formula: 'mifflin st jeor' });
  assert.deepEqual([spoken.inputs.weight, spoken.inputs.height, spoken.bmr], [70.5, 165, 1400]);
  assert.equal(energy({ ...base, height: '1,70 m' }).inputs.height, 170);
  assert.equal(energy({ ...base, age: 35.9 }).inputs.age, 35);
  assert.equal(energy({ ...base, height: 201 }).speech.includes('2,01 metros'), true);
});

test('gasto energético: o que falta ou está fora da faixa vira pergunta (422)', () => {
  const base = { weight: 70, height: 165, age: 35, sex: 'F' };
  const cases = [
    [{ ...base, weight: undefined }, /peso/], [{ ...base, weight: 29 }, /peso/], [{ ...base, weight: 301 }, /peso/], [{ ...base, weight: 'setenta' }, /peso/],
    [{ ...base, height: 110 }, /altura/], [{ ...base, height: 240 }, /altura/], [{ ...base, height: null }, /altura/], [{ ...base, height: '1.750' }, /altura/],
    [{ ...base, age: undefined }, /idade/], [{ ...base, age: 17 }, /adultos/], [{ ...base, age: 101 }, /entre 18 e 100/], [{ ...base, age: -3 }, /idade/],
    [{ ...base, sex: undefined }, /feminino ou masculino/], [{ ...base, sex: 'x' }, /feminino ou masculino/], [{ ...base, sex: 1 }, /feminino ou masculino/],
    [{ ...base, activity: 'atleta' }, /sedentário, leve, moderado, intenso ou muito intenso/], [{ ...base, activity: 3 }, /nível de atividade/],
    [{ ...base, formula: 'katch' }, /Mifflin-St Jeor ou a de Harris-Benedict/],
  ];
  for (const [input, speech] of cases) {
    const out = energy(input);
    assert.deepEqual([out.ok, out.status], [false, 422], JSON.stringify(input));
    assert.match(out.speech, speech, JSON.stringify(input));
  }
  for (const input of [null, undefined, 'texto', [1, 2], { weight: Infinity, height: 165, age: 30, sex: 'F' }]) assert.equal(energy(input).status, 422);
});

test('IMC: classificação da OMS para adultos, com os pontos de corte exatos', () => {
  // Com 2 metros de altura, o IMC é o peso dividido por 4.
  const table = [[72, 18, 'baixo peso'], [74, 18.5, 'eutrofia'], [99.6, 24.9, 'eutrofia'], [100, 25, 'sobrepeso'], [119.6, 29.9, 'sobrepeso'],
    [120, 30, 'obesidade grau 1'], [139.6, 34.9, 'obesidade grau 1'], [140, 35, 'obesidade grau 2'], [159.6, 39.9, 'obesidade grau 2'], [160, 40, 'obesidade grau 3'], [200, 50, 'obesidade grau 3']];
  for (const [weight, value, classification] of table) {
    const out = bmi({ weight, height: 200, age: 40 });
    assert.deepEqual([out.bmi, out.classification], [value, classification], String(weight));
    assert.equal(out.reference, 'OMS, para adultos');
  }
  const normal = bmi({ weight: 70, height: 170, age: 30 });
  assert.deepEqual(normal.healthyRange, { min: 53.5, max: 72 });
  assert.equal(normal.speech, 'O IMC fica em 24,2, o que é eutrofia, ou seja, peso adequado, pela classificação da OMS para adultos. '
    + 'Com 1,70 metro, a faixa de peso adequado vai de 53,5 a 72 quilos. ' + NOTE);
  assert.match(bmi({ weight: 95, height: 170, age: 30 }).speech, /^O IMC fica em 32,9, o que é obesidade grau 1 pela classificação da OMS para adultos\./);
});

test('IMC: idosos pela classificação de Lipschitz (SISVAN); sem idade, tabela de adultos e a Ali avisa', () => {
  const elderly = [[87.6, 21.9, 'baixo peso'], [88, 22, 'baixo peso'], [88.5, 22.1, 'eutrofia'], [107.6, 26.9, 'eutrofia'], [108, 27, 'sobrepeso'], [108.4, 27.1, 'sobrepeso'], [160, 40, 'sobrepeso']];
  for (const [weight, value, classification] of elderly) {
    const out = bmi({ weight, height: 200, age: 60 });
    assert.deepEqual([out.bmi, out.classification], [value, classification], String(weight));
    assert.match(out.reference, /Lipschitz/);
  }
  // IMC 27 aos 59 anos (tabela de adultos da OMS) também é sobrepeso.
  assert.equal(bmi({ weight: 108, height: 200, age: 59 }).classification, 'sobrepeso');
  const old = bmi({ weight: 60, height: 160, age: 70 });
  assert.deepEqual(old.healthyRange, { min: 56.3, max: 69.1 });
  assert.match(old.speech, /pela classificação de Lipschitz para idosos, usada pelo SISVAN\./);
  const noAge = bmi({ weight: 70, height: '1,70' });
  assert.equal(noAge.inputs.age, null);
  assert.equal(noAge.classification, 'eutrofia');
  assert.match(noAge.speech, /Como não tenho a idade, usei a tabela de adultos\./);
  assert.ok(noAge.speech.endsWith(NOTE));
});

test('IMC: menor de 18 anos, idade estranha, peso e altura fora da faixa viram pergunta (422)', () => {
  const young = bmi({ weight: 50, height: 160, age: 15 });
  assert.deepEqual([young.ok, young.status], [false, 422]);
  assert.match(young.speech, /curvas de crescimento da OMS/);
  for (const input of [{ weight: 70, height: 170, age: 'abc' }, { weight: 70, height: 170, age: 200 }, { weight: 10, height: 170 }, { weight: 70, height: 300 }, { weight: 70 }, {}, null]) {
    assert.equal(bmi(input).status, 422, JSON.stringify(input));
  }
});

test('macros: proteína por quilo (1,6 se ela não disser), gordura 30% e o resto em carboidrato', () => {
  const out = macros({ kcal: '2.000', weight: 70 });
  assert.equal(out.ok, true);
  assert.deepEqual([out.kcal, out.protein, out.fat, out.carbs], [2000, { grams: 112, kcal: 448, percent: 22 }, { grams: 67, kcal: 600, percent: 30 }, { grams: 238, kcal: 952, percent: 48 }]);
  assert.deepEqual([out.proteinPerKg, out.weight, out.fatPercent], [1.6, 70, 30]);
  assert.equal(out.speech, 'Para 2.000 calorias por dia: proteína, 112 gramas, que são 1,6 gramas por quilo e 22 por cento das calorias; '
    + 'gordura, 67 gramas, 30 por cento; e carboidrato, 238 gramas, 48 por cento. ' + NOTE);
  // 2 g/kg × 80 kg = 160 g (640 kcal); gordura 25% = 625 kcal (69 g); carboidrato 1235 kcal (309 g).
  const custom = macros({ kcal: '2500 kcal', weight: '80,0', proteinPerKg: '2 g/kg', fatPercent: '25 por cento' });
  assert.deepEqual([custom.protein, custom.fat, custom.carbs], [{ grams: 160, kcal: 640, percent: 26 }, { grams: 69, kcal: 625, percent: 25 }, { grams: 309, kcal: 1235, percent: 49 }]);
});

test('macros: sem o peso, proteína em 20% das calorias, e a Ali diz isso', () => {
  const out = macros({ kcal: 1800 });
  assert.deepEqual([out.protein, out.fat, out.carbs, out.proteinPerKg], [{ grams: 90, kcal: 360, percent: 20 }, { grams: 60, kcal: 540, percent: 30 }, { grams: 225, kcal: 900, percent: 50 }, null]);
  assert.match(out.speech, /Sem o peso, usei 20 por cento das calorias para a proteína\./);
  assert.ok(!out.speech.includes('por quilo'));
  assert.ok(out.speech.endsWith(NOTE));
});

test('macros: limites e combinações impossíveis viram pergunta (422)', () => {
  const cases = [
    [{ kcal: 799 }, /calorias/], [{ kcal: 6001 }, /calorias/], [{}, /calorias/], [{ kcal: 'muitas' }, /calorias/],
    [{ kcal: 2000, weight: 20 }, /peso/], [{ kcal: 2000, weight: 70, proteinPerKg: 0.5 }, /0,6 e 3,5/], [{ kcal: 2000, weight: 70, proteinPerKg: 3.6 }, /0,6 e 3,5/],
    // Ela disse a proteína por quilo mas não o peso: a Ali pergunta em vez de trocar pelos 20%.
    [{ kcal: 2000, proteinPerKg: 2 }, /preciso do peso/],
    [{ kcal: 2000, fatPercent: 14 }, /15 e 45/], [{ kcal: 2000, fatPercent: 46 }, /15 e 45/],
    [{ kcal: 800, weight: 150, proteinPerKg: 3.5 }, /não sobra caloria para o carboidrato/],
  ];
  for (const [input, speech] of cases) {
    const out = macros(input);
    assert.deepEqual([out.ok, out.status], [false, 422], JSON.stringify(input));
    assert.match(out.speech, speech, JSON.stringify(input));
  }
});

const PLAN = { days: [
  { name: 'Segunda', meals: [
    { time: '08:00', name: 'Café da manhã', items: ['2 ovos mexidos', 'Pão francês com pasta de amendoim', 'Leite zero lactose'], foods: [{ taco: 488, grams: 100 }, { taco: 53, grams: 50 }, null] },
    { time: '12:00', name: 'Almoço', items: ['Arroz', 'Feijão', 'Camarões grelhados'], foods: [{ taco: 3, grams: 150 }, { taco: 561, grams: 100 }, null] },
  ] },
  { name: 'Terça', meals: [{ time: '12:00', name: 'Almoço', items: ['Arroz', 'Feijão'], foods: [{ taco: 3, grams: 100 }, { taco: 561, grams: 100 }] }] },
] };
const AVOID = [
  { label: 'não gosta', term: 'ovo' }, { label: 'alergia', term: 'amendoim' }, { label: 'alergia', term: 'camarão' },
  { label: 'intolerância', term: 'lactose' }, { label: 'restrição', term: 'sem glúten' },
];

test('plano: total de cada dia pela TACO, média, proteína por quilo, meta e itens fora da conta', () => {
  context.plan = PLAN;
  const totals = plain(run('plan.days.map((day) => dayTotals(day))'));
  const out = check(PLAN, { patientName: 'Ana', label: 'plano aprovado', weight: 70, targetKcal: 1800 });
  assert.equal(out.ok, true);
  assert.deepEqual(out.days.map((day) => [day.name, day.kcal, day.protein, day.items, day.counted]), totals.map((t, i) => [PLAN.days[i].name, t.kcal, t.protein, t.items, t.counted]));
  const avg = (key) => Math.round((totals[0][key] + totals[1][key]) / 2);
  assert.deepEqual(out.average, { kcal: avg('kcal'), protein: avg('protein'), carbs: avg('carbs'), fat: avg('fat'), days: 2 });
  assert.equal(out.proteinPerKg, Math.round(((totals[0].protein + totals[1].protein) / 2 / 70) * 10) / 10);
  assert.deepEqual(out.target, { kcal: 1800, difference: out.average.kcal - 1800, percent: Math.round(((out.average.kcal - 1800) / 1800) * 100) });
  assert.equal(out.uncounted, 2);
  assert.deepEqual(out.flags, []);
  assert.match(out.speech, new RegExp(`^Plano aprovado de Ana, pela tabela TACO: em média, cerca de ${out.average.kcal} calorias por dia, com ${out.average.protein} gramas de proteína, ${out.average.carbs} de carboidrato e ${out.average.fat} de gordura\\.`));
  assert.match(out.speech, /Isso dá 0,\d gramas de proteína por quilo de peso\./);
  assert.match(out.speech, /calorias abaixo da meta de 1\.800, cerca de \d+ por cento a menos\./);
  assert.match(out.speech, /2 itens não estão ligados à tabela e ficaram fora da conta, então o total real pode ser maior\./);
  assert.ok(out.speech.endsWith(PLAN_NOTE));
  assert.ok(!out.speech.includes('Atenção'));
});

test('plano: o que bate com a ficha vem primeiro, do mais grave ao menos grave, e sem duplicar', () => {
  const out = check(PLAN, { patientName: 'Ana', label: 'rascunho do plano', avoid: AVOID });
  assert.ok(out.speech.startsWith('Atenção: o plano cita amendoim e camarão, e a ficha tem alergia a esses itens. Também cita ovo, e a ficha diz que Ana não gosta de ovo. Rascunho do plano de Ana'), out.speech);
  // Um ponto só: a frase do jeito que a Ali fala.
  const one = check(PLAN, { patientName: 'Ana', label: 'plano', avoid: [{ label: 'alergia', term: 'amendoim' }] });
  assert.ok(one.speech.startsWith('Atenção: o plano cita amendoim, e a ficha tem alergia a amendoim. Plano de Ana, pela tabela TACO:'), one.speech);
  assert.deepEqual(out.flags.map((flag) => [flag.label, flag.term, flag.item, flag.day, flag.meal]), [
    ['não gosta', 'ovo', '2 ovos mexidos', 'Segunda', 'Café da manhã'],
    ['alergia', 'amendoim', 'Pão francês com pasta de amendoim', 'Segunda', 'Café da manhã'],
    ['alergia', 'camarão', 'Camarões grelhados', 'Segunda', 'Almoço'],
  ]);
  // "Leite zero lactose" respeita a intolerância; "sem glúten" na ficha procura glúten, e o plano não tem.
  assert.ok(!out.speech.includes('lactose') && !out.speech.includes('glúten'));
  // O mesmo item em dois dias aparece uma vez só.
  const repeated = check(PLAN, { patientName: 'Ana', label: 'plano', avoid: [{ label: 'não gosta', term: 'arroz' }] });
  assert.deepEqual(repeated.flags.map((flag) => flag.day), ['Segunda']);
  assert.match(repeated.speech, /^Atenção: o plano cita arroz, e a ficha diz que Ana não gosta de arroz\. Plano de Ana, pela tabela TACO:/);
});

test('plano: palavra inteira, plural simples, negação e "sem" na ficha', () => {
  const plan = { days: [{ name: 'Dia', meals: [{ name: 'Lanche', items: ['Salada verde', 'Ovomaltine', 'Pão sem glúten', 'Biscoito com glúten', 'Iogurte livre de lactose', 'Nozes picadas', 'Leite sem lactose'] }] }] };
  const out = check(plan, { patientName: 'Bia', label: 'plano', avoid: [
    { label: 'restrição', term: 'sal' }, { label: 'alergia', term: 'ovo' }, { label: 'restrição', term: 'Sem glúten' },
    { label: 'intolerância', term: 'lactose' }, { label: 'alergia', term: 'noz' }, { label: 'alergia', term: 'leite' }, { label: 'outro', term: 'x' },
  ] });
  assert.deepEqual(out.flags.map((flag) => [flag.term, flag.item]), [['Sem glúten', 'Biscoito com glúten'], ['noz', 'Nozes picadas'], ['leite', 'Leite sem lactose']]);
  assert.match(out.speech, /^Atenção: o plano cita noz e leite, e a ficha tem alergia a esses itens\. Também cita glúten, e a ficha tem a restrição Sem glúten\./);
  // Rótulo que não é dos quatro conhecidos ainda é dito, de um jeito neutro.
  const other = check(plan, { patientName: 'Bia', label: 'plano', avoid: [{ label: 'cuidado', term: 'salada' }] });
  assert.match(other.speech, /^Atenção: o plano cita salada, e a ficha tem salada em cuidado\./);
});

test('plano: plurais em -ns, -ães, -éis e -ais também batem com a ficha', () => {
  const plan = { days: [{ name: 'Dia', meals: [{ name: 'Lanche', items: ['Mix de amendoins torrados', '2 pães franceses', 'Pastéis assados', 'Atuns em conserva'] }] }] };
  const out = check(plan, { patientName: 'Bia', label: 'plano', avoid: [
    { label: 'alergia', term: 'amendoim' }, { label: 'não gosta', term: 'pão' }, { label: 'não gosta', term: 'pastel' }, { label: 'alergia', term: 'atum' },
  ] });
  assert.deepEqual(out.flags.map((flag) => flag.term).sort(), ['amendoim', 'atum', 'pastel', 'pão']);
});

test('plano: muitos pontos da ficha cabem na fala, com "e mais N"', () => {
  const items = ['amendoim', 'camarão', 'castanha', 'kiwi', 'morango', 'soja'];
  const plan = { days: [{ name: 'Dia', meals: [{ name: 'Lanche', items, foods: [{ taco: 3, grams: 100 }] }] }] };
  const out = check(plan, { patientName: 'Maria Aparecida dos Santos', label: 'plano aprovado', weight: 60, targetKcal: 2000, avoid: items.map((term) => ({ label: 'alergia', term })) });
  assert.equal(out.flags.length, 6);
  assert.match(out.speech, /^Atenção: o plano cita amendoim, camarão, castanha e kiwi, e a ficha tem alergia a esses itens\. E mais 2 pontos da ficha aparecem no plano\./);
  assert.ok(out.speech.length <= 600, String(out.speech.length));
  assert.match(out.speech, /5 itens não estão ligados à tabela/);
  // Tipos diferentes, cada um com a sua frase; restrições e "não gosta" no plural.
  const mixed = check(plan, { patientName: 'Ana', label: 'plano', avoid: [
    { label: 'não gosta', term: 'kiwi' }, { label: 'não gosta', term: 'morango' }, { label: 'restrição', term: 'soja' }, { label: 'restrição', term: 'castanha' }, { label: 'restrição', term: 'camarão' },
  ] });
  assert.match(mixed.speech, /^Atenção: o plano cita camarão, castanha e soja, e esses itens estão nas restrições da ficha\. Também cita kiwi, e a ficha diz que Ana não gosta de kiwi\. E mais 1 ponto da ficha aparece no plano\./);
});

test('plano: sem itens ligados à TACO, a Ali explica; sem dias, 404', () => {
  const noTaco = { days: [{ name: 'Dia', meals: [{ name: 'Almoço', items: ['Arroz', 'Pasta de amendoim'] }] }] };
  const out = check(noTaco, { patientName: 'Ana', label: 'plano', weight: 70, targetKcal: 1800, avoid: [{ label: 'alergia', term: 'amendoim' }] });
  assert.equal(out.ok, true);
  assert.deepEqual([out.average, out.proteinPerKg, out.target, out.uncounted, out.flags.length], [null, null, null, 2, 1]);
  assert.equal(out.speech, 'Atenção: o plano cita amendoim, e a ficha tem alergia a amendoim. Plano de Ana ainda não tem itens ligados à tabela TACO, então não consigo calcular calorias nem macros. A conferência da ficha é só um apoio para a sua decisão.');
  assert.equal(check(noTaco, { patientName: 'Ana', label: 'plano' }).speech, 'Plano de Ana ainda não tem itens ligados à tabela TACO, então não consigo calcular calorias nem macros.');
  for (const plan of [null, undefined, {}, { days: [] }, { days: 'x' }, [], 'plano', { days: [null, 1, 'x'] }]) {
    const empty = check(plan, { patientName: 'Ana', label: 'plano' });
    assert.deepEqual([empty.ok, empty.status], [false, 404], JSON.stringify(plan));
    assert.equal(empty.speech, 'Plano de Ana não tem dias com refeições para eu conferir.');
  }
});

test('plano: dia sem cálculo fica fora da média; alimento em reavaliação é avisado; dados estranhos não quebram', () => {
  const partial = { days: [
    { name: 'Segunda', meals: [{ name: 'Almoço', items: ['Arroz'], foods: [{ taco: 3, grams: 100 }] }] },
    { name: 'Terça', meals: [{ name: 'Almoço', items: ['Arroz'] }] },
  ] };
  const out = check(partial, { patientName: 'Ana', label: 'plano' });
  assert.deepEqual(out.average, { kcal: 128, protein: 3, carbs: 28, fat: 0, days: 1 });
  assert.deepEqual(out.days[1], { name: 'Terça', kcal: null, protein: null, carbs: null, fat: null, items: 1, counted: 0, incomplete: true });
  assert.match(out.speech, /: cerca de 128 calorias por dia,.*A média considera só o dia com cálculo\./);
  // Leite integral: a própria TACO está reavaliando, então entra sem parte dos valores.
  const review = check({ days: [{ name: 'Dia', meals: [{ name: 'Café', items: ['Leite', 'Arroz'], foods: [{ taco: 458, grams: 200 }, { taco: 3, grams: 100 }] }] }] }, { patientName: '', label: '' });
  assert.match(review.speech, /^Plano do paciente, pela tabela TACO:/);
  assert.match(review.speech, /Alguns alimentos estão em reavaliação na TACO e entraram sem parte dos valores\./);
  const weird = { days: [null, { name: 42, meals: 'x' }, { name: '{Quarta}\u0007', meals: [null, { items: [7, null, 'Arroz', { a: 1 }], foods: 'x' }, { items: 'Arroz' }] }] };
  const odd = check(weird, { patientName: '{Ana}', label: 'plano', weight: 'abc', targetKcal: 0, avoid: [null, 'x', { label: 'alergia' }, { term: 'arroz' }, { label: 'alergia', term: 'arroz' }] });
  assert.equal(odd.ok, true);
  assert.deepEqual(odd.days.map((day) => day.name), ['Dia 1', 'Quarta']);
  assert.equal(odd.flags.length, 1);
  assert.ok(!odd.speech.includes('{') && !odd.speech.includes('\u0007'));
  assert.deepEqual([odd.proteinPerKg, odd.target], [null, null]);
  // Plano grande: só os primeiros 14 dias entram.
  const long = { days: Array.from({ length: 30 }, (_, i) => ({ name: `Dia ${i + 1}`, meals: [{ name: 'Almoço', items: ['Arroz'], foods: [{ taco: 3, grams: 100 }] }] })) };
  assert.equal(check(long, { patientName: 'Ana', label: 'plano' }).days.length, 14);
});

test('plano: meta igual, meta acima, peso e meta fora da faixa', () => {
  const plan = { days: [{ name: 'Dia', meals: [{ name: 'Almoço', items: ['Arroz'], foods: [{ taco: 3, grams: 1000 }] }] }] };
  assert.match(check(plan, { patientName: 'Ana', label: 'plano', targetKcal: 1280 }).speech, /Bate com a meta de 1\.280 calorias\./);
  assert.match(check(plan, { patientName: 'Ana', label: 'plano', targetKcal: 1000 }).speech, /Fica 280 calorias acima da meta de 1\.000, cerca de 28 por cento a mais\./);
  const off = check(plan, { patientName: 'Ana', label: 'plano', weight: 10, targetKcal: 9000 });
  assert.deepEqual([off.proteinPerKg, off.target], [null, null]);
});

console.log(`${count} verificações das calculadoras da Ali passaram. Nenhum serviço externo foi chamado.`);
