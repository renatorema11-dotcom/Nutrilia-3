// Testa a tabela de alimentos (TACO): os dados convertidos da planilha oficial, a busca sem acento e as contas
// por porção. Nada externo é chamado.
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { loadLib } = require('./fakes.cjs');

const context = loadLib(['taco-foods.ts', 'food-table.ts'], {});
const run = (code) => vm.runInContext(code, context);
const plain = (value) => JSON.parse(JSON.stringify(value));
const names = (query, options = {}) => plain(run(`searchFoods(${JSON.stringify(query)}, ${JSON.stringify(options)})`)).map((f) => f.name);

let count = 0;
function check(name, fn) { fn(); count++; }

check('dados: 597 alimentos da TACO, numerados de 1 a 597, em 14 categorias, com a fonte citada', () => {
  const foods = plain(run('allFoods()'));
  assert.equal(foods.length, 597);
  assert.deepEqual(foods.map((f) => f.id), Array.from({ length: 597 }, (_, i) => i + 1));
  assert.equal(new Set(foods.map((f) => f.category)).size, 14);
  assert.ok(foods.every((f) => f.name && f.category));
  assert.match(run('TACO_SOURCE'), /TACO.*4ª edição.*NEPA\/UNICAMP, 2011/);
  // Todo alimento fora da reavaliação tem energia; os de reavaliação são exatamente os marcados com * na planilha.
  const review = foods.filter((f) => f.underReview).map((f) => f.id);
  assert.equal(review.length, 21);
  assert.deepEqual(foods.filter((f) => typeof f.values.kcal !== 'number').map((f) => f.id), [450, 457, 458, 516, 517, 591]);
});

check('valores conferidos com a tabela impressa da TACO (por 100 g)', () => {
  const rice = plain(run('foodById(1)'));
  assert.equal(rice.name, 'Arroz, integral, cozido');
  assert.deepEqual([rice.values.kcal, rice.values.protein, rice.values.carbs, rice.values.fat, rice.values.fiber], [124, 2.6, 25.8, 1, 2.7]);
  assert.equal(rice.values.cholesterol, null); // NA: não se aplica
  assert.deepEqual([rice.values.thiamine, rice.values.riboflavin, rice.values.pyridoxine], [0.08, 'Tr', 0.08]);
  const beans = plain(run('foodById(561)'));
  assert.equal(beans.name, 'Feijão, carioca, cozido');
  assert.deepEqual([beans.values.kcal, beans.values.protein, beans.values.carbs, beans.values.fat, beans.values.fiber], [76, 4.8, 13.6, 0.5, 8.5]);
  const milk = plain(run('foodById(458)'));
  assert.equal(milk.name, 'Leite, de vaca, integral');
  assert.equal(milk.underReview, true);
  assert.equal(milk.values.kcal, null); // em reavaliação na própria TACO: não vira zero
  assert.equal(milk.values.calcium, 123);
  assert.equal(run('foodById(0)'), null);
  assert.equal(run("foodById('1')"), null);
});

check('busca: sem acento, plural, masculino/feminino, palavras de ligação e ordem da TACO', () => {
  assert.equal(names('feijao preto')[0], 'Feijão, preto, cozido');
  assert.deepEqual(names('arroz', { limit: 2 }), ['Arroz, integral, cozido', 'Arroz, integral, cru']);
  assert.equal(names('peito de frango sem pele')[0], 'Frango, peito, sem pele, cozido');
  assert.equal(names('carne moída')[0], 'Carne, bovina, acém, moído, cozido');
  assert.equal(names('pães franceses')[0], 'Pão, trigo, francês');
  assert.ok(names('ovos cozidos').includes('Ovo, de galinha, inteiro, cozido/10minutos'));
  assert.equal(names('LEITE INTEGRAL')[0], 'Leite, de vaca, integral');
  assert.equal(names('banana prata')[0], 'Banana, prata, crua');
  assert.deepEqual(names('whey protein'), []);
  assert.deepEqual(names('   '), []);
  assert.deepEqual(names('123'), ['Farinha, de puba']);
});

check('busca por categoria e limite de resultados', () => {
  const nuts = names('', { category: 'Nozes e sementes', limit: 100 });
  assert.equal(nuts.length, 11);
  assert.deepEqual(nuts, [...nuts].sort((a, b) => a.localeCompare(b, 'pt-BR')));
  assert.deepEqual(names('feijao', { category: 'Frutas e derivados' }), []);
  assert.equal(names('carne', { limit: 5 }).length, 5);
  assert.equal(names('', { category: 'Carnes e derivados', limit: 1000 }).length, 100);
});

check('porção: proporcional aos 100 g, com o arredondamento da TACO; traço e falta continuam como estão', () => {
  const portion = plain(run('foodPortion(foodById(1), 150)'));
  assert.equal(portion.kcal, 186);
  assert.equal(portion.protein, 3.9);
  assert.equal(portion.carbs, 38.7);
  assert.equal(portion.riboflavin, 'Tr');
  assert.equal(portion.cholesterol, null);
  assert.equal(plain(run('foodPortion(foodById(1), 0)')).kcal, 0);
  assert.equal(plain(run('foodPortion(foodById(458), 200)')).kcal, null);
  assert.equal(plain(run('foodPortion(foodById(458), 200)')).calcium, 246);
});

check('textos da tela: número em português, traços e falta de valor', () => {
  assert.equal(run("formatNutrient(2.6, 'g')"), '2,6 g');
  assert.equal(run("formatNutrient(124, 'kcal')"), '124 kcal');
  assert.equal(run("formatNutrient('Tr', 'mg')"), 'traços');
  assert.equal(run("formatNutrient(null, 'mg')"), '—');
  assert.equal(run("foodSearchText('Feijão, preto, cozido')"), 'feijao preto cozido');
});

console.log(`${count} verificações da tabela de alimentos (TACO) passaram. Nada externo foi chamado.`);
