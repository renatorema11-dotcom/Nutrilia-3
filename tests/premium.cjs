// Testa o NutriAli Premium: regras (lib/premium.ts), assinatura e avisos do Asaas (lib/asaas.ts, lib/asaas-client.ts) e a cortesia e a
// conferência do servidor (lib/premium-access.ts). O Asaas e o banco são simulados: nada externo é chamado.
const assert = require('node:assert/strict');
const { createFirestore, loadLib } = require('./fakes.cjs');

const TOKEN = 'token-do-webhook-de-teste-123';
const context = loadLib(['premium.ts', 'asaas-client.ts', 'consultation-payments.ts', 'asaas.ts', 'premium-access.ts'], {
  Intl,
  process: { env: { ASAAS_WEBHOOK_TOKEN: TOKEN } },
});
const lib = new Proxy({}, { get: (_, name) => require('node:vm').runInContext(String(name), context) });

/** Asaas simulado: responde por caminho e guarda as chamadas. */
function fakeAsaas(routes) {
  const calls = [];
  const request = async (path, init = {}) => {
    calls.push({ path, method: init.method || 'GET', body: init.body });
    const handler = routes[`${init.method || 'GET'} ${path}`];
    if (!handler) throw new (lib.AsaasError)(`sem rota ${path}`, 404);
    return typeof handler === 'function' ? handler(init.body) : handler;
  };
  return { calls, request };
}

// Objetos criados dentro do contexto isolado têm outro protótipo: compara pelo conteúdo.
const plain = (value) => JSON.parse(JSON.stringify(value));

const NOW = new Date('2026-10-29T15:00:00.000Z');
let count = 0;
async function check(name, fn) { await fn(); count++; }

(async () => {
  await check('CPF: confere os dígitos, aceita com ou sem pontuação e recusa sequências repetidas', () => {
    assert.equal(lib.validCpf('529.982.247-25'), '52998224725');
    assert.equal(lib.validCpf('52998224725'), '52998224725');
    assert.equal(lib.validCpf('529.982.247-24'), null);
    assert.equal(lib.validCpf('111.111.111-11'), null);
    assert.equal(lib.validCpf('123'), null);
    assert.equal(lib.validCpf(undefined), null);
  });

  await check('prazo: mês pago ou cortesia valem até o fim; o pagamento soma um mês e a tolerância, sem encurtar', () => {
    const now = NOW.getTime();
    assert.equal(lib.isPremiumActive({ paidUntil: '2026-11-01T00:00:00.000Z' }, now), true);
    assert.equal(lib.isPremiumActive({ paidUntil: '2026-10-01T00:00:00.000Z' }, now), false);
    assert.equal(lib.isPremiumActive({ courtesyUntil: '2026-12-01T00:00:00.000Z', paidUntil: null }, now), true);
    assert.equal(lib.isPremiumActive(null, now), false);
    assert.equal(lib.isPremiumActive({ subscriptionActive: true }, now), false);
    assert.equal(lib.premiumUntil({ paidUntil: '2026-11-01T00:00:00.000Z', courtesyUntil: '2026-12-01T00:00:00.000Z' }).toISOString(), '2026-12-01T00:00:00.000Z');
    // Pago hoje: um mês a partir de agora, mais 3 dias.
    assert.equal(lib.extendPaidUntil(undefined, '2026-10-29', NOW), '2026-12-02T15:00:00.000Z');
    // Pago adiantado (vencimento no futuro): conta a partir do vencimento.
    assert.equal(lib.extendPaidUntil(undefined, '2026-11-10', NOW), '2026-12-13T15:00:00.000Z');
    // Aviso repetido ou fora de ordem não encurta um prazo maior.
    assert.equal(lib.extendPaidUntil('2027-01-20T00:00:00.000Z', '2026-10-29', NOW), '2027-01-20T00:00:00.000Z');
  });

  await check('assinar: pede CPF só na primeira vez, cria cliente e assinatura mensal de R$ 19,90 e devolve o link da cobrança', async () => {
    const { db, store } = createFirestore();
    await db.collection('patients').doc('p1').set({ name: 'Ana Souza', email: 'ana@exemplo.com' });
    const asaas = fakeAsaas({
      'POST /customers': { id: 'cus_1' },
      'POST /subscriptions': { id: 'sub_1' },
      'GET /subscriptions/sub_1/payments': { data: [{ id: 'pay_1', status: 'PENDING', invoiceUrl: 'https://asaas.test/i/pay_1' }] },
    });
    const noCpf = await lib.startPremium(db, 'p1', { email: 'ana@exemplo.com', cpf: null }, asaas.request, NOW);
    assert.deepEqual({ ok: noCpf.ok, status: noCpf.status }, { ok: false, status: 422 });
    assert.equal(asaas.calls.length, 0);

    const first = await lib.startPremium(db, 'p1', { email: 'ana@exemplo.com', cpf: '52998224725' }, asaas.request, NOW);
    assert.deepEqual(plain(first), { ok: true, invoiceUrl: 'https://asaas.test/i/pay_1' });
    assert.deepEqual(plain(asaas.calls[0]), { path: '/customers', method: 'POST', body: { name: 'Ana Souza', email: 'ana@exemplo.com', cpfCnpj: '52998224725', externalReference: 'p1' } });
    assert.deepEqual(plain(asaas.calls[1].body), { customer: 'cus_1', billingType: 'UNDEFINED', value: 19.9, nextDueDate: '2026-10-29', cycle: 'MONTHLY', description: 'NutriAli Premium', externalReference: 'premium:p1' });
    assert.equal(store.get('billing/p1').asaasCustomerId, 'cus_1');
    assert.equal(store.get('billing/p1').premiumSubscriptionId, 'sub_1');
    assert.equal('cpf' in store.get('billing/p1') || JSON.stringify(store.get('billing/p1')).includes('52998224725'), false);
    assert.equal(store.get('patients/p1').premium.subscriptionActive, true);
    assert.equal(lib.isPremiumActive(store.get('patients/p1').premium, NOW.getTime()), false, 'só liga depois do pagamento');

    // Voltou sem pagar: recebe o mesmo link, sem outra assinatura.
    const again = await lib.startPremium(db, 'p1', { email: 'ana@exemplo.com', cpf: null }, asaas.request, NOW);
    assert.equal(again.invoiceUrl, 'https://asaas.test/i/pay_1');
    assert.equal(asaas.calls.filter((c) => c.path === '/subscriptions').length, 1);
  });

  await check('assinar de novo com Premium ativo e nada em aberto: recusa; prontuário que não existe: recusa', async () => {
    const { db } = createFirestore();
    await db.collection('patients').doc('p1').set({ name: 'Ana', premium: { paidUntil: '2026-12-01T00:00:00.000Z' } });
    await db.collection('billing').doc('p1').set({ asaasCustomerId: 'cus_1', premiumSubscriptionId: 'sub_1' });
    const asaas = fakeAsaas({ 'GET /subscriptions/sub_1/payments': { data: [{ status: 'RECEIVED', invoiceUrl: 'x' }] } });
    const result = await lib.startPremium(db, 'p1', { email: 'a@b.c', cpf: null }, asaas.request, NOW);
    assert.equal(result.status, 409);
    const missing = await lib.startPremium(db, 'ninguem', { email: 'a@b.c', cpf: '52998224725' }, asaas.request, NOW);
    assert.equal(missing.status, 404);
  });

  await check('aviso de pagamento: confere no Asaas, libera o Premium uma vez só e ignora o que não é do Premium', async () => {
    const { db, store } = createFirestore();
    await db.collection('patients').doc('p1').set({ name: 'Ana', premium: { subscriptionActive: true } });
    await db.collection('billing').doc('p1').set({ premiumSubscriptionId: 'sub_1' });
    const asaas = fakeAsaas({
      'GET /payments/pay_1': { id: 'pay_1', status: 'RECEIVED', subscription: 'sub_1', dueDate: '2026-10-29' },
      'GET /payments/pay_2': { id: 'pay_2', status: 'PENDING', subscription: 'sub_1', dueDate: '2026-10-29' },
      'GET /payments/pay_3': { id: 'pay_3', status: 'CONFIRMED', externalReference: 'consulta:abc', dueDate: '2026-10-29' },
    });
    // O corpo do aviso diz "pago", mas quem decide é a consulta ao Asaas.
    assert.equal(await lib.handleAsaasEvent(db, { id: 'evt_0', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_2', status: 'RECEIVED' } }, asaas.request, NOW), 'ignorado');
    assert.equal(lib.isPremiumActive(store.get('patients/p1').premium, NOW.getTime()), false);

    assert.equal(await lib.handleAsaasEvent(db, { id: 'evt_1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } }, asaas.request, NOW), 'premium liberado');
    assert.equal(store.get('patients/p1').premium.paidUntil, '2026-12-02T15:00:00.000Z');
    assert.equal(lib.isPremiumActive(store.get('patients/p1').premium, NOW.getTime()), true);
    assert.equal(await lib.hasPremium(db, 'p1', NOW.getTime()), true);

    const calls = asaas.calls.length;
    assert.equal(await lib.handleAsaasEvent(db, { id: 'evt_1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } }, asaas.request, NOW), 'repetido');
    assert.equal(asaas.calls.length, calls);

    assert.equal(await lib.handleAsaasEvent(db, { id: 'evt_2', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_3' } }, asaas.request, NOW), 'ignorado');
    assert.equal(await lib.handleAsaasEvent(db, { id: 'evt_3', event: 'PAYMENT_CREATED', payment: { id: 'pay_1' } }, asaas.request, NOW), 'ignorado');
    assert.equal(await lib.handleAsaasEvent(db, { event: 'PAYMENT_RECEIVED' }, asaas.request, NOW), 'ignorado');
  });

  await check('aviso pela referência premium:<uid>, estorno retira o Premium e assinatura encerrada é marcada', async () => {
    const { db, store } = createFirestore();
    await db.collection('patients').doc('p2').set({ name: 'Bia', premium: { subscriptionActive: true } });
    await db.collection('billing').doc('p2').set({ premiumSubscriptionId: 'sub_9' });
    const asaas = fakeAsaas({ 'GET /payments/pay_9': { id: 'pay_9', status: 'CONFIRMED', externalReference: 'premium:p2', dueDate: '2026-10-29' } });
    assert.equal(await lib.handleAsaasEvent(db, { id: 'e1', event: 'PAYMENT_CONFIRMED', payment: { id: 'pay_9' } }, asaas.request, NOW), 'premium liberado');
    assert.equal(lib.isPremiumActive(store.get('patients/p2').premium, NOW.getTime()), true);

    const later = new Date(NOW.getTime() + 60_000);
    assert.equal(await lib.handleAsaasEvent(db, { id: 'e2', event: 'PAYMENT_REFUNDED', payment: { id: 'pay_9', subscription: 'sub_9' } }, asaas.request, later), 'premium retirado');
    assert.equal(lib.isPremiumActive(store.get('patients/p2').premium, later.getTime() + 1), false);

    assert.equal(await lib.handleAsaasEvent(db, { id: 'e3', event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_9' } }, asaas.request, later), 'assinatura encerrada');
    assert.equal(store.get('patients/p2').premium.subscriptionActive, false);
    // Cobrança futura apagada ao cancelar não mexe no mês pago.
    assert.equal(await lib.handleAsaasEvent(db, { id: 'e4', event: 'PAYMENT_DELETED', payment: { id: 'pay_10', subscription: 'sub_9' } }, asaas.request, later), 'ignorado');
  });

  await check('cancelar: apaga a assinatura no Asaas e mantém o mês já pago; sem assinatura, avisa', async () => {
    const { db, store } = createFirestore();
    await db.collection('patients').doc('p1').set({ name: 'Ana', premium: { subscriptionActive: true, paidUntil: '2026-12-02T15:00:00.000Z' } });
    await db.collection('billing').doc('p1').set({ asaasCustomerId: 'cus_1', premiumSubscriptionId: 'sub_1' });
    const asaas = fakeAsaas({ 'DELETE /subscriptions/sub_1': { deleted: true } });
    assert.deepEqual(plain(await lib.cancelPremium(db, 'p1', asaas.request, NOW)), { ok: true });
    assert.equal(store.get('billing/p1').premiumSubscriptionId, null);
    assert.equal(store.get('patients/p1').premium.subscriptionActive, false);
    assert.equal(lib.isPremiumActive(store.get('patients/p1').premium, NOW.getTime()), true);
    const again = await lib.cancelPremium(db, 'p1', asaas.request, NOW);
    assert.equal(again.status, 404);
  });

  await check('webhook: só com o token combinado, comparado sem atalhos', () => {
    assert.equal(lib.webhookAuthorized(TOKEN), true);
    assert.equal(lib.webhookAuthorized('token-errado'), false);
    assert.equal(lib.webhookAuthorized(null), false);
    assert.equal(lib.webhookAuthorized(TOKEN, ''), false);
    assert.equal(lib.webhookAuthorized('curto', 'curto'), false);
  });

  await check('cortesia: pelo e-mail (também em maiúsculas), libera e retira; e-mail inválido, inexistente ou repetido é recusado', async () => {
    const { db, store } = createFirestore();
    await db.collection('patients').doc('p1').set({ name: 'Ana Souza', email: 'ana@exemplo.com' });
    const given = await lib.grantCourtesy(db, '  ANA@exemplo.com ', 30, NOW);
    assert.equal(given.ok, true);
    assert.equal(given.until, '2026-11-28T15:00:00.000Z');
    assert.equal(await lib.hasPremium(db, 'p1', NOW.getTime()), true);
    const removed = await lib.grantCourtesy(db, 'ana@exemplo.com', 0, NOW);
    assert.equal(removed.until, null);
    assert.equal(store.get('patients/p1').premium.courtesyUntil, null);
    assert.equal(await lib.hasPremium(db, 'p1', NOW.getTime()), false);
    assert.equal((await lib.grantCourtesy(db, 'nao-e-email', 10, NOW)).status, 422);
    assert.equal((await lib.grantCourtesy(db, 'ana@exemplo.com', 400, NOW)).status, 422);
    assert.equal((await lib.grantCourtesy(db, 'outra@exemplo.com', 10, NOW)).status, 404);
    await db.collection('patients').doc('p9').set({ name: 'Cópia', email: 'ana@exemplo.com' });
    assert.equal((await lib.grantCourtesy(db, 'ana@exemplo.com', 10, NOW)).status, 409);
    assert.equal(await lib.hasPremium(db, 'ninguem', NOW.getTime()), false);
  });

  console.log(`${count} verificações do Premium e do Asaas passaram. Nada externo foi chamado.`);
})().catch((error) => { console.error(error); process.exit(1); });
