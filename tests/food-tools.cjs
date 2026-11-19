// Testa as ferramentas da TACO da Ali da nutricionista (lib/food-tools.ts) e a busca de alimento que elas dividem com
// "quantas calorias tem…?" (resolveFood, em lib/food-info.ts). A tabela é a de verdade; não há banco nem serviço externo.
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { loadLib } = require('./fakes.cjs');

const context = loadLib(['ali-settings.ts', 'taco-foods.ts', 'food-table.ts', 'food-info.ts', 'food-tools.ts'], {});
const run = (code) => vm.runInContext(code, context);
const plain = (value) => JSON.parse(JSON.stringify(value));
const call = (fn, ...args) => { context.args = args; return plain(run(`${fn}(...args)`)); };
const nutrients = (input) => call('foodNutrients', input);
const compare = (input) => call('compareFoods', input);
const sources = (input) => call('foodSources', input);
const tacoValue = (id, key) => run(`foodById(${id}).values.${key}`);

let count = 0;
function test(name, fn) { fn(); count++; }

test('resolveFood: o mais comum no Brasil na frente, o mais parecido quando nada bate e null fora da tabela', () => {
  const rice = call('resolveFood', 'arroz');
  assert.deepEqual([rice.food.id, rice.exact, rice.others.map((food) => food.id)], [3, true, [1, 2]]);
  assert.deepEqual([call('resolveFood', 'banana prata').food.id, call('resolveFood', 'feijão').food.id], [182, 561]);
  const close = call('resolveFood', 'pão francês com manteiga');
  assert.deepEqual([close.food.name, close.exact], ['Pão, trigo, francês', false]);
  assert.equal(call('resolveFood', 'whey protein'), null);
  // A resposta de "quantas calorias tem…?" continua a mesma.
  assert.equal(call('foodInfo', 'banana prata').speech, 'Pela tabela TACO, 100 gramas de Banana, prata, crua têm cerca de 98 calorias, 1,3 gramas de proteína, 26 gramas de carboidrato e 0,1 gramas de gordura. Tem também 2 gramas de fibra.');
});

test('nutrientes: os principais por padrão, todos os 24 nos dados, unidades por extenso', () => {
  const out = nutrients({ food: 'banana prata' });
  assert.equal(out.ok, true);
  assert.deepEqual([out.food, out.group], [{ taco: 182, name: 'Banana, prata, crua', grams: 100 }, 'principais']);
  assert.equal(out.nutrients.length, 24);
  assert.deepEqual(out.nutrients.map((n) => n.key), plain(run('FOOD_NUTRIENTS.map((n) => n.key)')));
  assert.deepEqual(out.nutrients.find((n) => n.key === 'sodium'), { key: 'sodium', label: 'Sódio', unit: 'mg', value: 'Tr' });
  assert.equal(out.speech, 'Pela tabela TACO, 100 gramas de Banana, prata, crua têm cerca de 98 calorias, 1,3 gramas de proteína, 26 gramas de carboidrato, 0,1 gramas de gordura e 2 gramas de fibra.');
});

test('nutrientes: grupos (minerais, vitaminas, gorduras, tudo), porção, traços e zero', () => {
  const minerals = nutrients({ food: 'feijão', group: 'Minerais' });
  assert.equal(minerals.group, 'minerais');
  assert.match(minerals.speech, /^Pela tabela TACO, 100 gramas de Feijão, carioca, cozido têm 27 miligramas de cálcio, 1,3 miligramas de ferro,/);
  assert.ok(!minerals.speech.includes('calorias') && !minerals.speech.includes('proteína'));
  // 50 gramas: metade, arredondada como na tela.
  const half = nutrients({ food: 'feijão', grams: '50 g', group: 'mineral' });
  assert.equal(half.food.grams, 50);
  assert.equal(half.nutrients.find((n) => n.key === 'calcium').value, 14);
  assert.match(half.speech, /^Pela tabela TACO, 50 gramas de Feijão, carioca, cozido têm 14 miligramas de cálcio/);
  const vitamins = nutrients({ food: 'acerola', group: 'vitaminas' });
  assert.match(vitamins.speech, /941 miligramas de vitamina C/);
  assert.match(nutrients({ food: 'banana prata', group: 'vitaminas' }).speech, /traços de vitamina B1/);
  // Nas gorduras, a gordura total vem antes do detalhe.
  assert.match(nutrients({ food: 'azeite', group: 'gorduras' }).speech, /têm 100 gramas de gordura, \S+ gramas de gordura saturada,/);
  // Zero é dito "sem": o peito de frango grelhado não tem carboidrato na TACO.
  assert.equal(tacoValue(410, 'carbs'), 0);
  assert.match(nutrients({ food: 'frango grelhado' }).speech, /sem carboidrato/);
  // Tudo de uma vez não cabe na fala: os primeiros e "e mais N", com a dica de pedir por grupo.
  const all = nutrients({ food: 'banana prata', group: 'tudo' });
  assert.match(all.speech, / e mais \d+ valores\. Se quiser, peça só os minerais, as vitaminas ou as gorduras\.$/);
  assert.ok(all.speech.length <= 600, String(all.speech.length));
});

test('nutrientes: alimento em reavaliação, o mais parecido e as outras opções', () => {
  const milk = nutrients({ food: 'leite integral' });
  assert.equal(milk.food.taco, 458);
  assert.match(milk.speech, /^A tabela TACO não traz esses valores para Leite, de vaca, integral\. Alguns valores dele estão em reavaliação pela própria TACO\./);
  // O que a TACO tem do leite (as gorduras) continua sendo dito.
  assert.match(nutrients({ food: 'leite integral', group: 'gorduras' }).speech, /gordura saturada/);
  assert.match(nutrients({ food: 'pão francês com manteiga' }).speech, /^O mais parecido que achei na tabela TACO foi Pão, trigo, francês\. Pela tabela, 100 gramas/);
  assert.match(nutrients({ food: 'arroz' }).speech, /Se for outro, a tabela também tem Arroz, integral, cozido e Arroz, integral, cru\.$/);
  // O nome falado não leva o "/10minutos" da tabela; o dado leva o nome inteiro.
  const egg = nutrients({ food: 'ovo cozido' });
  assert.ok(!egg.speech.includes('minutos'));
  assert.match(egg.food.name, /10minutos/);
});

test('nutrientes: pedido inválido vira pergunta (422) e fora da tabela, 404', () => {
  for (const input of [{}, { food: '' }, { food: 'a' }, { food: 'x'.repeat(81) }, { food: 42 }, { food: 'arroz', grams: 0 }, { food: 'arroz', grams: 5000 }, { food: 'arroz', grams: 'muito' }, { food: 'arroz', group: 'proteínas' }, null]) {
    const out = nutrients(input);
    assert.deepEqual([out.ok, out.status], [false, 422], JSON.stringify(input));
  }
  assert.match(nutrients({ food: 'arroz', group: 'xyz' }).speech, /os principais, as gorduras, os minerais, as vitaminas ou tudo/);
  const missing = nutrients({ food: 'whey protein' });
  assert.deepEqual([missing.ok, missing.status], [false, 404]);
  assert.match(missing.speech, /^Não achei whey protein na tabela TACO\./);
  // O nome dito volta na fala sem chaves nem caracteres de controle.
  const odd = nutrients({ food: '{{whey}}\u0007 protein' });
  assert.equal(odd.status, 404);
  assert.ok(!/[{}\u0007]/.test(odd.speech), odd.speech);
  // Milhar com ponto, como se fala no Brasil: 1.500 gramas são mil e quinhentas, não uma e meia.
  assert.deepEqual([nutrients({ food: 'arroz', grams: '1.500 gramas' }).food.grams, nutrients({ food: 'arroz', grams: '1,5' }).food.grams, nutrients({ food: 'arroz', grams: '150g' }).food.grams], [1500, 2, 150]);
  assert.equal(nutrients({ food: 'arroz', grams: '2.500' }).status, 422);
});

test('comparar: mesma porção, as cinco medidas e quem tem mais proteína e menos calorias', () => {
  const out = compare({ foods: 'arroz e feijão' });
  assert.equal(out.ok, true);
  assert.deepEqual(out, {
    ok: true,
    speech: 'Pela tabela TACO, em 100 gramas: Arroz, tipo 1, cozido tem cerca de 128 calorias, 2,5 gramas de proteína, 28,1 de carboidrato, 0,2 de gordura e 1,6 de fibra. '
      + 'Feijão, carioca, cozido tem cerca de 76 calorias, 4,8 gramas de proteína, 13,6 de carboidrato, 0,5 de gordura e 8,5 de fibra. Feijão, carioca, cozido tem mais proteína e também menos calorias.',
    grams: 100,
    foods: [
      { taco: 3, name: 'Arroz, tipo 1, cozido', kcal: 128, protein: 2.5, carbs: 28.1, fat: 0.2, fiber: 1.6 },
      { taco: 561, name: 'Feijão, carioca, cozido', kcal: 76, protein: 4.8, carbs: 13.6, fat: 0.5, fiber: 8.5 },
    ],
  });
  const three = compare({ foods: ['ovo cozido', 'frango grelhado', 'tofu'], grams: 50 });
  assert.deepEqual(three.foods.map((food) => food.taco), [488, 410, 584]);
  assert.equal(three.grams, 50);
  assert.match(three.speech, /^Pela tabela TACO, em 50 gramas: Ovo, de galinha, inteiro, cozido tem cerca de 73 calorias/);
  assert.match(three.speech, /16 gramas de proteína, sem carboidrato e 1,3 de gordura/);
  assert.match(three.speech, /Frango, peito, sem pele, grelhado tem mais proteína\. Soja, queijo \(tofu\) tem menos calorias\.$/);
  assert.ok(three.speech.length <= 600);
});

test('comparar: separadores falados, empate e o mesmo alimento duas vezes', () => {
  for (const foods of ['ovo x frango', 'ovo vs frango', 'ovo versus frango', 'ovo ou frango', 'ovo, frango', 'ovo; frango', ['ovo', 'frango'], ['ovo e frango']]) {
    assert.deepEqual(compare({ foods }).foods.map((food) => food.taco), [488, 410], JSON.stringify(foods));
  }
  // Arroz tipo 1 e tipo 2 crus: mesmas calorias e mesma proteína na TACO.
  const tie = compare({ foods: ['arroz tipo 1 cru', 'arroz tipo 2 cru'] });
  assert.deepEqual(tie.foods.map((food) => [food.taco, food.kcal, food.protein]), [[4, 358, 7.2], [6, 358, 7.2]]);
  assert.match(tie.speech, /A proteína é a mesma\. As calorias são as mesmas\.$/);
  const same = compare({ foods: 'arroz e arroz tipo 1 cozido' });
  assert.deepEqual([same.ok, same.status], [false, 422]);
  assert.match(same.speech, /^Arroz e arroz tipo 1 cozido caíram no mesmo alimento da tabela, Arroz, tipo 1, cozido\./);
});

test('comparar: quantidade de alimentos, texto estranho e alimento fora da tabela', () => {
  for (const input of [{}, { foods: 'arroz' }, { foods: ['arroz'] }, { foods: 'arroz, feijão, ovo e frango' }, { foods: ['arroz', 42] }, { foods: ['arroz', 'a'] },
    { foods: ['arroz', 'x'.repeat(81)] }, { foods: { a: 1 } }, { foods: 'arroz e feijão', grams: 0 }, { foods: 'arroz e feijão', grams: '3000' }, null]) {
    const out = compare(input);
    assert.deepEqual([out.ok, out.status], [false, 422], JSON.stringify(input));
  }
  const missing = compare({ foods: ['arroz', 'whey protein', 'qwzx'] });
  assert.deepEqual([missing.ok, missing.status], [false, 404]);
  assert.match(missing.speech, /^Não achei whey protein e qwzx na tabela TACO\./);
});

test('fontes: ranking por 100 gramas, só com números, e a fala com unidade por extenso', () => {
  const iron = sources({ nutrient: 'ferro' });
  assert.equal(iron.ok, true);
  assert.deepEqual(iron.nutrient, { key: 'iron', label: 'Ferro', unit: 'mg' });
  assert.equal(iron.foods.length, 5);
  assert.deepEqual(iron.foods[0], { taco: 114, name: 'Coentro, folhas desidratadas', category: 'Verduras, hortaliças e derivados', value: 81 });
  assert.match(iron.speech, /^Pela tabela TACO, os alimentos com mais ferro em 100 gramas são: Coentro, folhas desidratadas, com 81 miligramas; Mingau tradicional, pó, com 42 miligramas;/);
  // Conferência contra a própria tabela: o primeiro é mesmo o maior e a lista está em ordem.
  const best = plain(run(`allFoods().filter((f) => typeof f.values.iron === 'number').sort((a, b) => b.values.iron - a.values.iron || a.id - b.id).slice(0, 5).map((f) => f.id)`));
  assert.deepEqual(iron.foods.map((food) => food.taco), best);
  // Calorias: o leite integral (em reavaliação, sem valor) e quem tem traço ficam de fora.
  const energy = sources({ nutrient: 'calorias', limit: 10 });
  assert.ok(energy.foods.every((food) => typeof food.value === 'number'));
  assert.ok(energy.foods.every((food, i) => i === 0 || energy.foods[i - 1].value >= food.value));
  assert.match(energy.speech, /os alimentos com mais calorias em 100 gramas são: .+, com \d[\d.]* calorias;/);
});

test('fontes: limite de 3 a 10, categoria (também com apelido) e "e mais N" quando não cabe', () => {
  assert.equal(sources({ nutrient: 'ferro', limit: 1 }).foods.length, 3);
  assert.equal(sources({ nutrient: 'ferro', limit: 50 }).foods.length, 10);
  assert.equal(sources({ nutrient: 'ferro', limit: '7' }).foods.length, 7);
  assert.equal(sources({ nutrient: 'ferro', limit: 'muitos' }).foods.length, 5);
  const fruit = sources({ nutrient: 'proteína', category: 'frutas' });
  assert.ok(fruit.foods.every((food) => food.category === 'Frutas e derivados'));
  assert.match(fruit.speech, /^Pela tabela TACO, entre frutas e derivados, os alimentos com mais proteína em 100 gramas são: Tamarindo, cru, com 3,2 gramas;/);
  const fish = sources({ nutrient: 'cálcio', category: 'peixe' });
  assert.ok(fish.foods.every((food) => food.category === 'Pescados e frutos do mar'));
  const many = sources({ nutrient: 'vitamina c', limit: 10 });
  assert.equal(many.foods.length, 10);
  assert.ok(many.speech.length <= 600, String(many.speech.length));
  assert.match(many.speech, /e mais \d+\.$/);
  const wrong = sources({ nutrient: 'ferro', category: 'pizzas' });
  assert.deepEqual([wrong.ok, wrong.status], [false, 422]);
  assert.match(wrong.speech, /As categorias são: cereais e derivados, .* e nozes e sementes\.$/);
  // Pedaço curto demais bateria com quase tudo: a Ali diz as categorias em vez de filtrar errado.
  assert.equal(sources({ nutrient: 'ferro', category: 'e' }).status, 422);
});

test('fontes: todos os nutrientes da tabela pelo nome, pela chave e por apelidos; desconhecido vira 422', () => {
  for (const n of plain(run('FOOD_NUTRIENTS'))) {
    assert.equal(sources({ nutrient: n.key }).nutrient.key, n.key, n.key);
    assert.equal(sources({ nutrient: n.label }).nutrient.key, n.key, n.label);
  }
  const aliases = { 'Cálcio': 'calcium', 'potássio': 'potassium', 'magnésio': 'magnesium', zinco: 'zinc', 'sódio': 'sodium', sal: 'sodium', 'Vitamina C': 'vitaminC', 'fósforo': 'phosphorus',
    colesterol: 'cholesterol', carboidratos: 'carbs', gordura: 'fat', energia: 'kcal', calorias: 'kcal', fibras: 'fiber', 'gordura saturada': 'saturated', 'vitamina A': 'retinol',
    'vitamina B1': 'thiamine', 'vitamina b2': 'riboflavin', 'vitamina B6': 'pyridoxine', niacina: 'niacin', 'manganês': 'manganese', cobre: 'copper', 'poli-insaturada': 'polyunsaturated', 'o ferro': 'iron' };
  for (const [spoken, key] of Object.entries(aliases)) assert.equal(sources({ nutrient: spoken }).nutrient.key, key, spoken);
  for (const nutrient of ['vitamina b12', 'ômega 3', '', 42, null, 'x'.repeat(100)]) {
    const out = sources({ nutrient });
    assert.deepEqual([out.ok, out.status], [false, 422], String(nutrient));
    assert.match(out.speech, /por exemplo, ferro, cálcio, proteína/);
  }
  assert.equal(sources(null).status, 422);
});

console.log(`${count} verificações das ferramentas da TACO passaram. Nenhum serviço externo foi chamado.`);
