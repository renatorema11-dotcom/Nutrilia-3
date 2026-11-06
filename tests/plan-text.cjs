// Testa o plano na tela do paciente (lib/plan-text.ts): o texto da IA sem tabela nem HTML, as refeições achadas nele,
// o grupo de dias que vale hoje e os números e datas em português (lib/format.ts). Nada externo é chamado.
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { loadLib } = require('./fakes.cjs');

const context = loadLib(['agenda.ts', 'daily-log.ts', 'plan-text.ts', 'format.ts'], { Intl, Date, JSON, Set });
const run = (code) => vm.runInContext(code, context);
const plain = (value) => JSON.parse(JSON.stringify(value));

let count = 0;
function check(name, fn) { fn(); count++; }

// Trecho de verdade: foi assim que um cardápio criativo apareceu cru na tela.
const TABLE = `🟢 Plano Criativo – 1 Dia para Hipertrofia (20 anos, 80 kg, 1,81 m)

| Horário | Refeição | Prato “Criativo” | Porções (g) | Macronutrientes* |
|--------|----------|------------------|------------|-------------------|
| 07:30 | **Café da manhã** | **Smoothie Power “Tropical”** <br>‑ 200 ml de leite de aveia <br>‑ 1 banana congelada | 350 ml total | **≈ 45 g P / 55 g C / 12 g G** |
| 12:30 | **Almoço** | **Bowl “Muscle‑Mundo”** <br>‑ 150 g de frango | 450 g | **≈ 45 g P / 55 g C / 20 g G** |

\\* **Total diário aproximado:** **190 g de proteína**

---

Dicas “Criativas” para potencializar a hipertrofia
1. **Cores = nutrientes** – Cada refeição traz cores.

Bom apetite! 🚀`;

check('tabela da IA vira título e lista, sem barras nem HTML', () => {
  context.source = TABLE;
  const text = run('planTextToMarkdown(source)');
  assert.ok(!text.includes('|'), text);
  assert.ok(!/<br/i.test(text), text);
  assert.ok(text.includes('## Café da manhã (07:30)'), text);
  assert.ok(text.includes('- 200 ml de leite de aveia'), text);
  assert.ok(text.includes('- Porção: 350 ml total'), text);
  assert.equal(run('planTextToMarkdown(undefined)'), '');
});

check('caractere quebrado que a IA manda no fim do texto sai', () => {
  context.source = 'Coma bem após o treino.�';
  assert.equal(run('planTextToMarkdown(source)'), 'Coma bem após o treino.');
});

check('só refeição conta como refeição: título do plano e dicas ficam de fora', () => {
  context.source = TABLE;
  const meals = plain(run('mealsFromPlanText(source)'));
  assert.deepEqual(meals.map((meal) => meal.name), ['Café da manhã', 'Almoço']);
  assert.deepEqual(meals.map((meal) => meal.time), ['07:30', '12:30']);
  assert.ok(meals[0].items.includes('1 banana congelada'));
  assert.ok(!JSON.stringify(meals).includes('**'));
  assert.ok(!JSON.stringify(meals).includes('Total diário'));
});

check('refeições em títulos, em negrito e em linha com dois-pontos', () => {
  context.source = '## Café da Manhã (08:00)\n- Ovos\n- Pão\n\n## Dicas\n- Beba água\n\n**Almoço**\n* Arroz\n\nJantar (19h30): sopa de legumes';
  const meals = plain(run('mealsFromPlanText(source)'));
  assert.deepEqual(meals, [
    { id: 'meal_0', name: 'Café da Manhã', time: '08:00', items: ['Ovos', 'Pão'] },
    { id: 'meal_1', name: 'Almoço', items: ['Arroz'] },
    { id: 'meal_2', name: 'Jantar', time: '19:30', items: ['sopa de legumes'] },
  ]);
  context.source = 'Coma frutas e beba água ao longo do dia.';
  assert.deepEqual(plain(run('mealsFromPlanText(source)')), []);
});

check('o nome do grupo diz os dias da semana', () => {
  const days = (name) => plain(run(`weekdaysOfDayName(${JSON.stringify(name)})`)).sort();
  assert.deepEqual(days('Segunda a Sexta'), [1, 2, 3, 4, 5]);
  assert.deepEqual(days('Fim de Semana'), [0, 6]);
  assert.deepEqual(days('Sábado'), [6]);
  assert.deepEqual(days('Segunda-feira'), [1]);
  assert.deepEqual(days('Dias úteis'), [1, 2, 3, 4, 5]);
  assert.deepEqual(days('Plano do dia'), []);
});

check('vale o grupo de hoje, em Brasília; sem pista, o primeiro', () => {
  context.groups = [{ name: 'Segunda a Sexta', meals: [{ name: 'Almoço', time: '12:00', items: ['Arroz'] }] }, { name: 'Fim de Semana', meals: [{ name: 'Churrasco', items: ['Carne'] }] }];
  // Sábado 7/11 às 1h em UTC ainda é sexta 6/11 em Brasília.
  assert.equal(run("planDayIndexForToday(groups, new Date('2026-11-07T01:00:00Z'))"), 0);
  assert.equal(run("planDayIndexForToday(groups, new Date('2026-11-07T15:00:00Z'))"), 1);
  assert.equal(run("planDayIndexForToday([{ name: 'Plano' }, { name: 'Outro' }], new Date('2026-11-07T15:00:00Z'))"), 0);
});

check('refeições de hoje: o plano aprovado vem antes do cardápio salvo', () => {
  context.groups = [{ name: 'Segunda a Sexta', meals: [{ name: 'Almoço', time: '12:00', items: ['Arroz'] }] }, { name: 'Fim de Semana', meals: [{ name: 'Churrasco', items: ['Carne'] }] }];
  context.saved = [{ id: '1', content: '## Lanche da tarde\n- Fruta' }];
  const names = (code) => plain(run(code)).map((meal) => meal.name);
  assert.deepEqual(names("todayMealsOf({ currentPlan: { days: groups }, savedPlans: saved }, new Date('2026-11-06T15:00:00Z'))"), ['Almoço']);
  assert.deepEqual(names("todayMealsOf({ currentPlan: { days: groups } }, new Date('2026-11-07T15:00:00Z'))"), ['Churrasco']);
  assert.deepEqual(names('todayMealsOf({ currentPlan: null, savedPlans: saved })'), ['Lanche da tarde']);
  assert.deepEqual(names('todayMealsOf({})'), []);
  assert.deepEqual(names('todayMealsOf(null)'), []);
});

check('o plano prescrito vira texto legível, sem JSON', () => {
  context.groups = [{ name: 'Segunda a Sexta', meals: [{ name: 'Almoço', time: '12:00', items: ['Arroz'] }] }];
  const text = run('planDaysToMarkdown(groups)');
  assert.equal(text, '## Segunda a Sexta\n\n### Almoço (12:00)\n- Arroz');
  assert.equal(run('planDaysToMarkdown(undefined)'), '');
});

check('números com vírgula e datas no formato brasileiro', () => {
  assert.equal(run('formatKg(80)'), '80,0');
  assert.equal(run('formatKg(72.5)'), '72,5');
  assert.equal(run("formatKg('72.5')"), '72,5');
  assert.equal(run('formatKgShort(80)'), '80');
  assert.equal(run('formatKgShort(72.5)'), '72,5');
  assert.equal(run("formatDayKey('2026-10-30')"), '30/10/2026');
  assert.equal(run("formatDayKey('2026-10-30T10:00:00Z')"), '30/10/2026');
  assert.equal(run("formatDayKey('sem data')"), 'sem data');
  assert.equal(run("localDayKey(new Date(2026, 10, 3, 22, 30))"), '2026-11-03');
});

console.log(`${count} verificações do plano na tela do paciente passaram. Nada externo foi chamado.`);
