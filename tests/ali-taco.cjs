// Testa a TACO nas duas Alis: a resposta para "quantas calorias tem…?" (lib/food-info.ts) e a foto do prato com
// os pesos estimados ligados à tabela (lib/meal-photo-taco.ts). A IA é simulada; nada externo é chamado.
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { loadLib } = require('./fakes.cjs');

const context = loadLib(['taco-foods.ts', 'food-table.ts', 'food-info.ts', 'ai.ts', 'taco-match.ts', 'meal-photo.ts', 'meal-photo-taco.ts'], {
  JSON, console: { warn: () => {}, error: () => {} }, process: { env: {} },
});
const run = (code) => vm.runInContext(code, context);
const plain = (value) => JSON.parse(JSON.stringify(value));
const info = (food, grams) => { context.f = food; context.g = grams; return plain(run('foodInfo(f, g)')); };

let count = 0;
async function check(name, fn) { await fn(); count++; }

const asked = [];
let answer = null;
context.ask = async (request) => { asked.push(request); if (answer instanceof Error) throw answer; return answer; };

(async () => {
  await check('calorias: porção pedida (100 g se ninguém disse), números falados em português e o alimento da TACO', async () => {
    const banana = info('banana prata');
    assert.equal(banana.speech, 'Pela tabela TACO, 100 gramas de Banana, prata, crua têm cerca de 98 calorias, 1,3 gramas de proteína, 26 gramas de carboidrato e 0,1 gramas de gordura. Tem também 2 gramas de fibra.');
    assert.deepEqual(banana.food, { taco: 182, name: 'Banana, prata, crua', grams: 100, kcal: 98, protein: 1.3, carbs: 26, fat: 0.1 });
    assert.match(info('arroz integral', 150).speech, /^Pela tabela TACO, 150 gramas de Arroz, integral, cozido têm cerca de 186 calorias, 3,9 gramas de proteína/);
    assert.match(info('frango grelhado', '120').speech, /120 gramas de Frango, peito, sem pele, grelhado têm cerca de 191 calorias/);
    // O nome falado não leva o "/10minutos" da tabela.
    assert.match(info('ovo cozido', 50).speech, /50 gramas de Ovo, de galinha, inteiro, cozido têm cerca de 73 calorias/);
  });

  await check('calorias: palavra genérica vai para o mais comum no Brasil, e as outras opções são citadas', async () => {
    assert.match(info('azeite', 10).speech, /^Pela tabela TACO, 10 gramas de Azeite, de oliva, extra virgem têm cerca de 88 calorias e 10 gramas de gordura\. Se for outro, a tabela também tem Azeite, de dendê\.$/);
    assert.match(info('arroz').speech, /de Arroz, tipo 1, cozido têm cerca de 128 calorias.* Se for outro, a tabela também tem Arroz, integral, cozido e Arroz, integral, cru\.$/);
    assert.equal(info('feijão').food.taco, 561);
    assert.equal(info('Café').food.taco, 471);
  });

  await check('calorias: o mais parecido, alimento em reavaliação, fora da tabela e pedido inválido', async () => {
    assert.match(info('pão francês com manteiga').speech, /^O mais parecido que achei na tabela TACO foi Pão, trigo, francês\. Pela tabela, 100 gramas/);
    const milk = info('leite integral');
    assert.match(milk.speech, /Leite, de vaca, integral está com os valores em reavaliação pela própria TACO/);
    assert.equal(milk.food.kcal, null);
    assert.deepEqual([info('whey protein').status, info('whey protein').ok], [404, false]);
    for (const [food, grams] of [['', undefined], ['a', 100], ['x'.repeat(81), 100], ['arroz', 0], ['arroz', 5000], ['arroz', 'muito'], [42, 100]]) {
      assert.equal(info(food, grams).status, 422, JSON.stringify([food, grams]));
    }
  });

  await check('foto do prato: o peso de cada item é guardado; peso fora do razoável fica de fora', async () => {
    context.data = { dish: 'Prato feito', items: [
      { name: 'Arroz branco cozido', portion: '4 colheres', gramas: 120, kcal: 150 },
      { name: 'Feijão carioca', portion: '1 concha', grams: 100, kcal: 80 },
      { name: 'Molho', portion: 'um pouco', gramas: 99999, kcal: 40 },
    ], kcalMin: 300, kcalMax: 400, comparison: '' };
    const photo = plain(run('normalizeMealPhoto(data)'));
    assert.deepEqual(photo.items.map((item) => item.grams), [120, 100, undefined]);
  });

  await check('foto do prato: itens ligados à TACO, soma dos que entraram e a mensagem para a Ali', async () => {
    context.photo = run('normalizeMealPhoto(data)');
    asked.length = 0;
    answer = { escolhas: [{ i: 0, taco: 3 }, { i: 1, taco: 561 }] };
    const out = plain(await run('addMealTaco(photo, ask)'));
    assert.equal(asked.length, 1);
    assert.equal(asked[0].prompt.split('\n').length, 2); // o molho, sem peso, nem é perguntado
    assert.deepEqual(out.items[0].taco, { id: 3, name: 'Arroz, tipo 1, cozido', kcal: 154, protein: 3, carbs: 33.7, fat: 0.2 });
    assert.equal(out.items[2].taco, undefined);
    assert.deepEqual(out.taco, { kcal: 230, protein: 8, carbs: 47, fat: 1, counted: 2, items: 3 });
    context.out = out;
    const partial = run('mealPhotoMessage(out)');
    // Nem todos os itens na tabela: a faixa visual continua; os itens trazem o valor da TACO.
    assert.match(partial, /Arroz branco cozido \(4 colheres, cerca de 120 g, cerca de 154 kcal pela tabela TACO\)/);
    assert.match(partial, /Calorias estimadas pela imagem: entre 300 e 400 kcal/);
    assert.ok(!partial.includes('Calorias pela tabela TACO'));
    // Todos os itens na tabela: o total da TACO substitui a faixa visual, sempre como estimativa.
    context.full = { ...out, items: out.items.slice(0, 2), taco: { ...out.taco, items: 2 } };
    const full = run('mealPhotoMessage(full)');
    assert.match(full, /Calorias pela tabela TACO, com as porções estimadas pela foto: cerca de 230 kcal, com 8 g de proteína, 47 g de carboidrato e 1 g de gordura\. Use estes números, sempre como estimativa/);
    assert.ok(!full.includes('Calorias estimadas pela imagem'));
  });

  await check('foto do prato: sem peso, sem prato ou com a IA fora do ar, a análise segue como estava', async () => {
    asked.length = 0;
    context.nogram = { isFood: true, dish: 'Salada', items: [{ name: 'Alface', portion: '', kcal: 10 }], kcalMin: 10, kcalMax: 20, comparison: '' };
    assert.deepEqual(plain(await run('addMealTaco(nogram, ask)')), plain(context.nogram));
    context.notfood = { isFood: false, dish: '', items: [], kcalMin: null, kcalMax: null, comparison: '' };
    assert.deepEqual(plain(await run('addMealTaco(notfood, ask)')), plain(context.notfood));
    assert.equal(asked.length, 0);
    answer = new Error('IA fora do ar');
    const out = plain(await run('addMealTaco(photo, ask)'));
    assert.equal(out.taco, null);
    assert.ok(out.items.every((item) => item.taco === undefined));
    // Escolha fora das opções não vale.
    answer = { escolhas: [{ i: 0, taco: 999 }, { i: 1, taco: 561 }] };
    const picked = plain(await run('addMealTaco(photo, ask)'));
    assert.deepEqual([picked.items[0].taco, picked.taco.counted], [undefined, 1]);
  });

  console.log(`${count} verificações da TACO na Ali (calorias e foto do prato) passaram. A IA foi simulada.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
