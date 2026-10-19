// Testa as calorias e macros do plano pela TACO: o peso de cada item no rascunho da IA, a ligação dos itens aos
// alimentos da tabela (a IA só escolhe entre as opções que o app achou) e as contas por refeição e por dia.
// A IA é simulada; nada externo é chamado.
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { loadLib } = require('./fakes.cjs');

const context = loadLib(['taco-foods.ts', 'food-table.ts', 'plan-nutrition.ts', 'ai.ts', 'taco-match.ts', 'plan-draft.ts'], {
  JSON, console: { warn: () => {}, error: () => {} }, process: { env: {} },
});
const run = (code) => vm.runInContext(code, context);
const plain = (value) => JSON.parse(JSON.stringify(value));

let count = 0;
async function check(name, fn) { await fn(); count++; }

const asked = [];
let answer = null;
context.ask = async (request) => {
  asked.push(request);
  if (answer instanceof Error) throw answer;
  return answer;
};

(async () => {
  await check('rascunho: o peso de cada item anda junto com ele; peso inválido vira 0 e sem peso nenhum não há "grams"', async () => {
    context.raw = { days: [{ name: 'Segunda a Sexta', meals: [
      { time: '08:00', name: 'Café', items: ['2 ovos mexidos', '', 'Café sem açúcar', 'Pão integral'], gramas: [100, 999, -5, 30] },
      { time: '12:00', name: 'Almoço', items: ['Arroz integral'], grams: [5000] },
      { time: '16:00', name: 'Lanche', items: ['Maçã'] },
    ] }] };
    const plan = plain(run('normalizePlan(raw)'));
    assert.deepEqual(plan.days[0].meals[0].items, ['2 ovos mexidos', 'Café sem açúcar', 'Pão integral']);
    assert.deepEqual(plan.days[0].meals[0].grams, [100, 0, 30]);
    assert.equal('grams' in plan.days[0].meals[1], false);
    assert.equal('grams' in plan.days[0].meals[2], false);
  });

  await check('ligação à TACO: a IA escolhe só entre as opções de cada item; item repetido é perguntado uma vez', async () => {
    context.plan = { days: [
      { name: 'Segunda a Sexta', meals: [
        { time: '08:00', name: 'Café', items: ['2 ovos mexidos', '1 fatia de pão integral', 'Água à vontade'], grams: [100, 30, 0] },
        { time: '12:00', name: 'Almoço', items: ['4 colheres de sopa de arroz integral', '1 concha de feijão carioca', 'Whey protein'], grams: [150, 100, 30] },
      ] },
      { name: 'Fim de Semana', meals: [{ time: '09:00', name: 'Café', items: ['2 ovos mexidos'], grams: [100] }] },
    ] };
    asked.length = 0;
    // Ordem das perguntas: ovos (0), pão (1), arroz (2), feijão (3). Whey não tem opção na TACO; água tem peso 0.
    answer = { escolhas: [{ i: 0, taco: 488 }, { i: 1, taco: 52 }, { i: 2, taco: 1 }, { i: 3, taco: 999 }, { i: 9, taco: 1 }, { i: 'x', taco: 2 }] };
    const out = plain(await run('addPlanFoods(plan, ask)'));
    assert.equal(asked.length, 1);
    const lines = asked[0].prompt.split('\n');
    assert.equal(lines.length, 4);
    assert.match(lines[0], /^0\. "2 ovos mexidos" → opções: .*488 Ovo, de galinha, inteiro, cozido\/10minutos/);
    assert.match(lines[2], /^2\. "4 colheres de sopa de arroz integral" → opções: 1 Arroz, integral, cozido; 2 Arroz, integral, cru/);
    assert.match(asked[0].system, /Use somente números que aparecem nas opções do próprio item/);
    const [cafe, almoco] = out.days[0].meals;
    assert.deepEqual(cafe.foods, [{ taco: 488, grams: 100 }, { taco: 52, grams: 30 }, null]);
    // Feijão: 999 não estava entre as opções, então fica fora; o resto da refeição continua.
    assert.deepEqual(almoco.foods, [{ taco: 1, grams: 150 }, null, null]);
    assert.deepEqual(out.days[1].meals[0].foods, [{ taco: 488, grams: 100 }]);
    assert.ok(out.days.every((day) => day.meals.every((meal) => !('grams' in meal))));
  });

  await check('sem peso ou com a IA fora do ar: o rascunho segue sem as contas, do jeito que era', async () => {
    asked.length = 0;
    context.plan = { days: [{ name: 'Dia', meals: [{ time: '', name: 'Almoço', items: ['Arroz'] }] }] };
    assert.deepEqual(plain(await run('addPlanFoods(plan, ask)')), { days: [{ name: 'Dia', meals: [{ time: '', name: 'Almoço', items: ['Arroz'] }] }] });
    assert.equal(asked.length, 0);
    context.plan = { days: [{ name: 'Dia', meals: [{ time: '', name: 'Almoço', items: ['Arroz integral'], grams: [150] }] }] };
    answer = new Error('IA fora do ar');
    assert.deepEqual(plain(await run('addPlanFoods(plan, ask)')), { days: [{ name: 'Dia', meals: [{ time: '', name: 'Almoço', items: ['Arroz integral'] }] }] });
    answer = { outra: 'coisa' };
    assert.deepEqual(plain(await run('addPlanFoods(plan, ask)')), { days: [{ name: 'Dia', meals: [{ time: '', name: 'Almoço', items: ['Arroz integral'] }] }] });
  });

  await check('contas: refeição e dia pela TACO, com o aviso quando algum item ficou fora', async () => {
    context.meal = { items: ['Arroz integral', 'Feijão carioca', 'Item fora'], foods: [{ taco: 1, grams: 150 }, { taco: 561, grams: 100 }, null] };
    const meal = plain(run('mealTotals(meal)'));
    // 186 + 76 kcal; 3,9 + 4,8 g de proteína; 38,7 + 13,6 g de carboidrato; 1,5 + 0,5 g de gordura.
    assert.deepEqual(meal, { kcal: 262, protein: 9, carbs: 52, fat: 2, items: 3, counted: 2, incomplete: true });
    const rows = plain(run('planItemsNutrition(meal)'));
    assert.deepEqual(rows[0], { item: 'Arroz integral', name: 'Arroz, integral, cozido', grams: 150, kcal: 186, protein: 3.9, carbs: 38.7, fat: 1.5 });
    assert.equal(rows[2], null);
    context.day = { meals: [context.meal, { items: ['Banana prata'], foods: [{ taco: 182, grams: 100 }] }, { items: ['Sem contas'] }] };
    const day = plain(run('dayTotals(day)'));
    assert.deepEqual([day.kcal, day.items, day.counted, day.incomplete], [262 + 98, 5, 3, true]);
    context.old = { meals: [{ items: ['Arroz'] }] };
    assert.equal(run('dayTotals(old)'), null);
    assert.equal(run('mealTotals(old.meals[0])'), null);
  });

  await check('contas: alimento em reavaliação na TACO e dados estranhos no plano salvo', async () => {
    context.meal = { items: ['Leite integral'], foods: [{ taco: 458, grams: 200 }] };
    const milk = plain(run('mealTotals(meal)'));
    assert.deepEqual([milk.kcal, milk.counted, milk.incomplete], [0, 1, true]); // a TACO não traz as calorias do leite integral
    // Azeite: carboidrato "não se aplica" na TACO conta como zero, sem marcar o total como incompleto.
    context.meal = { items: ['Azeite'], foods: [{ taco: 260, grams: 10 }] };
    assert.deepEqual(plain(run('mealTotals(meal)')), { kcal: 88, protein: 0, carbs: 0, fat: 10, items: 1, counted: 1, incomplete: false });
    context.meal = { items: ['a', 'b', 'c', 'd', 'e'], foods: [{ taco: 9999, grams: 100 }, { taco: 1, grams: 0 }, { taco: 1, grams: 5000 }, { taco: '1', grams: 100 }, 'x'] };
    assert.deepEqual(plain(run('planFoodsOf(meal)')), [null, null, null, null, null]);
    assert.equal(run('mealTotals(meal)'), null);
    assert.deepEqual(plain(run("planFoodsOf({ items: ['a'], foods: 'x' })")), [null]);
    assert.deepEqual(plain(run('planFoodsOf(null)')), []);
  });

  console.log(`${count} verificações das calorias e macros do plano (TACO) passaram. A IA foi simulada.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
