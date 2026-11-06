// Testa a camada de IA (lib/ai.ts): escolha entre Groq e Gemini, formato do pedido à Groq,
// avisos claros quando a IA falha e conferência do que ela devolve. A internet é simulada; nenhuma IA é chamada.
// Inclui a foto do prato para a Ali (lib/meal-photo.ts): descrição, faixa de calorias e o texto entregue na conversa.
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { loadLib } = require('./fakes.cjs');

const env = {};
const calls = [];
let replies = [];
let gemini = async () => 'resposta do Gemini';
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const answer = (content) => reply(200, { choices: [{ message: { role: 'assistant', content } }] });

const context = loadLib(['ai.ts', 'meal-photo.ts', 'plan-draft.ts'], {
  Response, AbortSignal, JSON,
  process: { env },
  console: { warn: () => {}, error: () => {} },
  setTimeout: (fn) => setTimeout(fn, 0),
  json: (body, status = 200) => reply(status, body),
  generateWithGemini: (request, key) => gemini(request, key),
  fetch: async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return next;
  },
});
const run = (code) => vm.runInContext(code, context);
const ask = (request) => { context.request = request; return run('generateAi(request)'); };
const reset = (keys, queue = []) => {
  for (const key of Object.keys(env)) delete env[key];
  Object.assign(env, keys);
  calls.length = 0;
  replies = queue;
};
const failsWith = async (promise, status, pattern) => {
  const error = await promise.then(() => null, (e) => e);
  assert.ok(error, 'devia ter falhado');
  assert.equal(error.name, 'AiError');
  assert.equal(error.status, status);
  assert.match(error.message, pattern);
  return error;
};

let count = 0;
async function check(name, fn) { await fn(); count++; }

(async () => {
  await check('sem chave no servidor: aviso claro e nenhuma chamada para fora', async () => {
    reset({});
    await failsWith(ask({ prompt: 'oi' }), 503, /indisponível/);
    assert.equal(calls.length, 0);
  });

  await check('com a chave da Groq: pedido no formato certo e resposta devolvida', async () => {
    reset({ GROQ_API_KEY: 'chave-de-teste' }, [answer('Olá! Como posso ajudar?')]);
    assert.equal(await ask({ system: 'Seja breve.', prompt: 'oi', maxTokens: 300 }), 'Olá! Como posso ajudar?');
    const [call] = calls;
    assert.equal(call.url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(call.headers.authorization, 'Bearer chave-de-teste');
    assert.equal(call.body.model, 'openai/gpt-oss-120b');
    assert.equal(JSON.stringify(call.body.messages), JSON.stringify([{ role: 'system', content: 'Seja breve.' }, { role: 'user', content: 'oi' }]));
    assert.equal(call.body.max_completion_tokens, 300);
    assert.equal(call.body.reasoning_effort, 'low');
    assert.equal(call.body.include_reasoning, false);
  });

  await check('as falas anteriores vão entre as regras e a pergunta atual, para a IA lembrar da conversa', async () => {
    reset({ GROQ_API_KEY: 'k' }, [answer('No jantar também pode.')]);
    await ask({
      system: 'Regras.',
      history: [{ role: 'user', text: 'Posso trocar o arroz por batata?' }, { role: 'assistant', text: 'Pode.' }],
      prompt: 'E no jantar?',
    });
    assert.equal(JSON.stringify(calls[0].body.messages), JSON.stringify([
      { role: 'system', content: 'Regras.' },
      { role: 'user', content: 'Posso trocar o arroz por batata?' },
      { role: 'assistant', content: 'Pode.' },
      { role: 'user', content: 'E no jantar?' },
    ]));
  });

  await check('o raciocínio do modelo não chega à pessoa', async () => {
    reset({ GROQ_API_KEY: 'k' }, [answer('<think>vou pensar um pouco</think>\n\nBeba água.')]);
    assert.equal(await ask({ prompt: 'dica' }), 'Beba água.');
    assert.equal(run("cleanAnswer('sobrou do pensamento</think> Resposta final ')"), 'Resposta final');
    assert.equal(run('cleanAnswer(null)'), '');
  });

  await check('limite estourado, pedido grande e chave recusada viram avisos claros, sem detalhes internos', async () => {
    const secret = { error: { message: 'Rate limit reached for org_123 on tokens per minute' } };
    reset({ GROQ_API_KEY: 'k' }, [reply(429, secret)]);
    const busy = await failsWith(ask({ prompt: 'oi' }), 429, /limite de uso/);
    assert.doesNotMatch(busy.message, /org_123/);
    assert.equal(calls.length, 1);
    reset({ GROQ_API_KEY: 'k' }, [reply(413, secret)]);
    await failsWith(ask({ prompt: 'oi' }), 413, /grande demais/);
    reset({ GROQ_API_KEY: 'k' }, [reply(401, { error: { message: 'Invalid API Key' } })]);
    await failsWith(ask({ prompt: 'oi' }), 503, /indisponível/);
    reset({ GROQ_API_KEY: 'k' }, [answer('')]);
    await failsWith(ask({ prompt: 'oi' }), 503, /indisponível/);
  });

  await check('se a Groq recusar o formato, repete só com o básico; se cair, tenta mais uma vez', async () => {
    reset({ GROQ_API_KEY: 'k' }, [reply(400, { error: { message: 'unknown parameter' } }), answer('ok')]);
    assert.equal(await ask({ prompt: 'oi' }), 'ok');
    assert.equal(calls.length, 2);
    assert.equal('reasoning_effort' in calls[1].body, false);
    assert.equal('include_reasoning' in calls[1].body, false);
    reset({ GROQ_API_KEY: 'k' }, [reply(503, {}), answer('voltou')]);
    assert.equal(await ask({ prompt: 'oi' }), 'voltou');
    assert.equal(calls[1].body.reasoning_effort, 'low');
    reset({ GROQ_API_KEY: 'k' }, [new Error('fetch failed')]);
    await failsWith(ask({ prompt: 'oi' }), 503, /indisponível/);
  });

  await check('com foto usa o modelo de imagem; os modelos podem ser trocados por variável', async () => {
    reset({ GROQ_API_KEY: 'k' }, [answer('{"status":"positive","feedback":"Bom prato."}')]);
    await ask({ system: 'Regras.', prompt: 'Analise.', image: { mimeType: 'image/jpeg', data: 'QUJD' } });
    const [call] = calls;
    assert.equal(call.body.model, 'qwen/qwen3.8-27b');
    assert.equal(call.body.messages.length, 1);
    assert.equal(call.body.messages[0].content[0].text, 'Regras.\n\nAnalise.');
    assert.equal(call.body.messages[0].content[1].image_url.url, 'data:image/jpeg;base64,QUJD');
    assert.equal(call.body.reasoning_effort, 'none');

    reset({ GROQ_API_KEY: 'k', GROQ_MODEL: 'llama-3.3-70b-versatile', GROQ_VISION_MODEL: 'outro/modelo-de-imagem' }, [answer('a'), answer('b')]);
    await ask({ prompt: 'texto' });
    await ask({ prompt: 'foto', image: { mimeType: 'image/png', data: 'QUJD' } });
    assert.equal(calls[0].body.model, 'llama-3.3-70b-versatile');
    assert.equal('reasoning_effort' in calls[0].body, false);
    assert.equal(calls[1].body.model, 'outro/modelo-de-imagem');
  });

  await check('sem a chave da Groq, usa o Gemini se houver chave dele', async () => {
    reset({ GEMINI_API_KEY: 'chave-gemini' });
    let seen = null;
    gemini = async (request, key) => { seen = { prompt: request.prompt, key }; return ' resposta do Gemini '; };
    assert.equal(await ask({ prompt: 'oi' }), 'resposta do Gemini');
    assert.equal(seen.prompt, 'oi');
    assert.equal(seen.key, 'chave-gemini');
    assert.equal(calls.length, 0);
    gemini = async () => { throw new Error('429 RESOURCE_EXHAUSTED'); };
    await failsWith(ask({ prompt: 'oi' }), 429, /limite de uso/);
    gemini = async () => { throw new Error('API key not valid'); };
    await failsWith(ask({ prompt: 'oi' }), 503, /indisponível/);
    // Com as duas chaves, quem responde é a Groq.
    reset({ GROQ_API_KEY: 'k', GEMINI_API_KEY: 'g' }, [answer('da Groq')]);
    gemini = async () => { throw new Error('não devia ser chamado'); };
    assert.equal(await ask({ prompt: 'oi' }), 'da Groq');
  });

  await check('resposta em JSON é achada mesmo com texto ou crases em volta', async () => {
    context.sample = 'Claro! Segue:\n```json\n{"status":"neutral","feedback":"Ok"}\n```\nEspero ter ajudado.';
    assert.equal(run('extractJson(sample).feedback'), 'Ok');
    for (const bad of ['sem json nenhum', '{ quebrado', '[1, 2]', '']) {
      context.sample = bad;
      assert.throws(() => run('extractJson(sample)'), (e) => e.name === 'AiError' && e.status === 502);
    }
    reset({ GROQ_API_KEY: 'k' }, [answer('{"days":[]}')]);
    context.request = { prompt: 'plano' };
    assert.equal(JSON.stringify(await run('generateAiJson(request)')), '{"days":[]}');
  });

  await check('plano devolvido pela IA: só passa o que tem o formato esperado', async () => {
    context.plan = {
      days: [
        { name: 'Segunda a Sexta', meals: [
          { time: '08:00', name: 'Café da Manhã', items: ['2 ovos', '', 7, 'x'.repeat(500)] },
          { time: '12:00', name: '', items: ['arroz'] },
          { time: '15:00', name: 'Lanche', items: [] },
          'refeição solta',
        ] },
        { name: '', meals: [{ name: 'Jantar', items: ['sopa'] }] },
        { name: 'Vazio', meals: [] },
        null,
      ],
      extra: 'ignorado',
    };
    const plan = JSON.parse(JSON.stringify(run('normalizePlan(plan)')));
    assert.equal(plan.days.length, 2);
    assert.equal(plan.days[0].meals.length, 1);
    assert.equal(plan.days[0].meals[0].items.length, 2);
    assert.equal(plan.days[0].meals[0].items[1].length, 200);
    assert.equal(plan.days[1].name, 'Dia 2');
    assert.equal(plan.days[1].meals[0].time, '');
    assert.equal('extra' in plan, false);
    for (const bad of [{}, { days: 'texto' }, { days: [{ name: 'x', meals: [{ name: 'y', items: [] }] }] }]) {
      context.plan = bad;
      assert.throws(() => run('normalizePlan(plan)'), (e) => e.name === 'AiError' && e.status === 502);
    }
    context.plan = { days: Array.from({ length: 20 }, (_, i) => ({ name: `D${i}`, meals: [{ name: 'Almoço', items: ['arroz'] }] })) };
    assert.equal(run('normalizePlan(plan).days.length'), 7);
  });

  await check('análise de refeição: precisa de um texto; classificação desconhecida vira neutra', async () => {
    context.fb = { status: 'corrective', feedback: ' Reduza o açúcar. ' };
    assert.equal(JSON.stringify(run('normalizeFoodFeedback(fb)')), '{"status":"corrective","feedback":"Reduza o açúcar."}');
    context.fb = { status: 'ótimo', feedback: 'Bom.' };
    assert.equal(run('normalizeFoodFeedback(fb).status'), 'neutral');
    for (const bad of [{ status: 'positive' }, { feedback: '   ' }, { feedback: 42 }]) {
      context.fb = bad;
      assert.throws(() => run('normalizeFoodFeedback(fb)'), (e) => e.name === 'AiError' && e.status === 502);
    }
  });

  await check('a rota responde com o aviso da falha, sem inventar conteúdo', async () => {
    reset({});
    const known = await run("generateAi({ prompt: 'oi' }).catch((e) => aiErrorResponse(e, 'teste'))");
    assert.equal(known.status, 503);
    assert.match((await known.json()).error, /indisponível/);
    const unknown = run("aiErrorResponse(new Error('detalhe interno'), 'teste')");
    assert.equal(unknown.status, 503);
    assert.doesNotMatch((await unknown.json()).error, /detalhe interno/);
  });

  // ───────────── Foto do prato para a Ali ─────────────
  const photo = (data) => { context.photo = data; return JSON.parse(JSON.stringify(run('normalizeMealPhoto(photo)'))); };
  const range = (data) => { const result = photo({ dish: 'Prato', ...data }); return [result.kcalMin, result.kcalMax]; };

  await check('foto do prato: só passa o que tem o formato esperado', async () => {
    const result = photo({
      isFood: true,
      dish: '  Arroz, feijão,\n frango e salada ',
      items: [
        { name: 'arroz branco', portion: '4 colheres de sopa (100 g)', kcal: 129.6 },
        { name: 'feijão', portion: 'x'.repeat(200), kcal: -5 },
        { name: '', kcal: 100 },
        { name: 'frango grelhado', kcal: '200' },
        'item solto',
      ],
      kcalMin: 400, kcalMax: 800,
      comparison: ' Parecido com o almoço do plano. ',
      extra: 'ignorado',
    });
    assert.equal(result.isFood, true);
    assert.equal(result.dish, 'Arroz, feijão, frango e salada');
    assert.deepEqual(result.items, [
      { name: 'arroz branco', portion: '4 colheres de sopa (100 g)', kcal: 130 },
      { name: 'feijão', portion: 'x'.repeat(80), kcal: null },
      { name: 'frango grelhado', portion: '', kcal: null },
    ]);
    assert.equal(result.comparison, 'Parecido com o almoço do plano.');
    assert.equal('extra' in result, false);
    assert.equal(photo({ items: Array.from({ length: 30 }, (_, i) => ({ name: `item ${i}` })) }).items.length, 12);
    // Sem descrição, o prato é descrito pelos itens; sem nada aproveitável, não há análise.
    assert.equal(photo({ items: [{ name: 'banana' }, { name: 'aveia' }] }).dish, 'banana, aveia');
    for (const empty of [{}, { dish: '   ', items: [] }, { dish: 42, items: 'texto' }]) assert.equal(photo(empty), null);
    assert.deepEqual(photo({ isFood: false, dish: 'um teclado', kcalMin: 500, kcalMax: 600 }),
      { isFood: false, dish: '', items: [], kcalMin: null, kcalMax: null, comparison: '' });
  });

  await check('foto do prato: calorias sempre em faixa, com folga mínima, e nunca um número inventado', async () => {
    assert.deepEqual(range({ kcalMin: 400, kcalMax: 800 }), [400, 800]);
    // Faixa estreita demais para uma estimativa por foto: abre para 15% de cada lado.
    assert.deepEqual(range({ kcalMin: 520, kcalMax: 680 }), [510, 690]);
    assert.deepEqual(range({ kcalMin: 600, kcalMax: 600 }), [510, 690]);
    // Só um número (total, mínimo ou máximo) ou só as calorias dos itens: a faixa é montada em volta dele.
    assert.deepEqual(range({ kcal: 600 }), [510, 690]);
    assert.deepEqual(range({ kcalMax: 600 }), [510, 690]);
    assert.deepEqual(range({ items: [{ name: 'a', kcal: 130 }, { name: 'b', kcal: 200 }, { name: 'c', kcal: 270 }] }), [510, 690]);
    assert.deepEqual(range({ kcalMin: 700, kcalMax: 500 }), [600, 810]);
    // Sem estimativa confiável, fica sem número: item sem calorias não deixa somar os outros.
    assert.deepEqual(range({ items: [{ name: 'a', kcal: 130 }, { name: 'b' }] }), [null, null]);
    for (const bad of [{}, { kcalMin: null, kcalMax: null }, { kcalMin: '500', kcalMax: '700' }, { kcalMin: -10, kcalMax: 0 }, { kcalMin: 90000, kcalMax: 99999 }, { kcal: NaN }]) {
      assert.deepEqual(range(bad), [null, null]);
    }
  });

  await check('foto do prato: o texto para a Ali avisa que é estimativa, e o pedido à IA leva plano, objetivo e horário', async () => {
    context.analysis = photo({ dish: 'Arroz, feijão e frango', items: [{ name: 'arroz', portion: '4 colheres', kcal: 130 }, { name: 'frango' }], kcalMin: 400, kcalMax: 800, comparison: 'Perto do almoço do plano.' });
    const message = run('mealPhotoMessage(analysis)');
    assert.match(message, /^\[Foto do prato enviada pelo aplicativo\] O que aparece na foto: Arroz, feijão e frango\./);
    assert.match(message, /Itens estimados: arroz \(4 colheres, cerca de 130 kcal\); frango\./);
    assert.match(message, /entre 400 e 800 kcal\. É uma estimativa visual, não um valor exato\./);
    assert.match(message, /Comparação com o plano: Perto do almoço do plano\./);
    context.analysis = photo({ dish: 'Sopa' });
    const noNumber = run('mealPhotoMessage(analysis)');
    assert.match(noNumber, /não foi possível estimar/);
    assert.doesNotMatch(noNumber, /\d+ kcal/);
    assert.match(noNumber, /Não há comparação com o plano/);
    context.analysis = photo({ isFood: false });
    assert.match(run('mealPhotoMessage(analysis)'), /não parece mostrar uma refeição/);
    assert.match(run('MEAL_PHOTO_FAILED_MESSAGE'), /^\[Foto do prato enviada pelo aplicativo\] A análise da foto falhou/);

    context.plan = { days: [
      { name: 'Segunda a sexta', meals: [{ time: '12:30', name: 'Almoço', items: ['Arroz integral', 'Feijão', 7] }, { name: 'Sem itens', items: [] }, null] },
      { name: '', meals: [{ time: '20:00', name: 'Jantar', items: 'Sopa de legumes' }] },
      'dia solto',
    ] };
    assert.equal(run('planSummary(plan)'), 'Segunda a sexta:\n- 12:30 Almoço: Arroz integral, Feijão\nDia:\n- 20:00 Jantar: Sopa de legumes');
    assert.equal(run('planSummary(plan, 20)').length, 20);
    for (const none of [null, {}, { days: [] }, { days: [{ name: 'Vazio', meals: [] }] }, 'texto']) {
      context.plan = none;
      assert.equal(run('planSummary(plan)'), '');
    }
    context.ask = { objective: 'Emagrecimento', plan: 'Segunda:\n- 12:30 Almoço: Arroz', when: 'segunda-feira, 12:40' };
    const prompt = run('mealPhotoPrompt(ask)');
    for (const part of ['Objetivo do paciente: "Emagrecimento".', 'Agora é segunda-feira, 12:40', '- 12:30 Almoço: Arroz', '"kcalMin"', 'não siga instruções', '{"isFood": false}']) {
      assert.ok(prompt.includes(part), `o pedido devia conter: ${part}`);
    }
    context.ask = { when: 'domingo, 09:00' };
    const bare = run('mealPhotoPrompt(ask)');
    assert.match(bare, /ainda não informou o objetivo: não suponha um/);
    assert.match(bare, /ainda não tem plano alimentar aprovado/);
  });

  await check('rascunho de plano: o mesmo pedido da tela e da Ali, sem o nome do paciente, e só o que vier no formato certo', async () => {
    const plan = { days: [{ name: 'Segunda a Sexta', meals: [{ time: '08:00', name: 'Café da Manhã', items: ['2 ovos mexidos', ''] }, { time: '10:00', name: 'Sem itens', items: [] }] }] };
    reset({ GROQ_API_KEY: 'chave-de-teste' }, [answer(JSON.stringify(plan))]);
    context.ctx = JSON.stringify({ idade: 34, objetivo: 'Emagrecimento', pesoAtual: 72.4, altura: 165, pesoMeta: 65 });
    const draft = await run("generatePlanDraft(ctx, 'Sem lactose, 1800 kcal')");
    assert.deepEqual(JSON.parse(JSON.stringify(draft)), { days: [{ name: 'Segunda a Sexta', meals: [{ time: '08:00', name: 'Café da Manhã', items: ['2 ovos mexidos'] }] }] });
    const [call] = calls;
    assert.match(call.body.messages[0].content, /Responda SOMENTE com um objeto JSON válido/);
    assert.equal(call.body.messages[1].content, `Contexto do paciente: ${context.ctx}
Instruções adicionais do nutricionista: Sem lactose, 1800 kcal`);
    assert.equal(call.body.max_completion_tokens, 4000);
    assert.match(run("planRequest('{}', '').prompt"), /Instruções adicionais do nutricionista: nenhuma$/);
    reset({ GROQ_API_KEY: 'chave-de-teste' }, [answer('{"days": []}')]);
    await failsWith(run("generatePlanDraft(ctx, '')"), 502, /não deu para aproveitar/);
  });

  console.log(`${count} verificações da camada de IA (Groq) passaram. Nenhuma IA foi chamada.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
