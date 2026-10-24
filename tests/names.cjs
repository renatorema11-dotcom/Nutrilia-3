// Testa os nomes de exibição (lib/names.ts): o título ("Dra.", "Dr", "Nutri") não vira inicial do avatar
// nem primeiro nome ("Conversar no Chat com Dra."). Nada externo é chamado.
const assert = require('node:assert/strict');
const { loadLib } = require('./fakes.cjs');

const context = loadLib(['names.ts'], {});
const run = (code) => require('node:vm').runInContext(code, context);

let count = 0;
function check(name, fn) { fn(); count++; }

check('títulos do começo ficam de fora do primeiro nome e da inicial', () => {
  const cases = [
    ['Dra. Carla Mendes', 'Carla', 'C'],
    ['dr Paulo Souza', 'Paulo', 'P'],
    ['Nutri Ana', 'Ana', 'A'],
    ['Nutricionista Renato', 'Renato', 'R'],
    ['  Profa.   Beatriz  Lima ', 'Beatriz', 'B'],
    ['Dra. Dr. Joana', 'Joana', 'J'],
  ];
  for (const [full, first, initial] of cases) {
    context.full = full;
    assert.equal(run('firstName(full)'), first, full);
    assert.equal(run('nameInitial(full)'), initial, full);
  }
});

check('nomes sem título, só com título e vazios', () => {
  context.full = 'renato Gabriel';
  assert.equal(run('firstName(full)'), 'renato');
  assert.equal(run('nameInitial(full)'), 'R');
  // Só o título: melhor mostrar a palavra do que nada.
  context.full = 'Dra.';
  assert.equal(run('firstName(full)'), 'Dra.');
  for (const empty of ['', '   ', null, undefined]) {
    context.full = empty;
    assert.equal(run('firstName(full)'), '');
    assert.equal(run('nameInitial(full)'), '');
  }
});

console.log(`${count} verificações dos nomes de exibição passaram. Nada externo foi chamado.`);
