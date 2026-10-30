// Testa as consultas pagas pelo app (lib/consultation-payments.ts): preço, conta da nutricionista no Asaas, cobrança
// com a divisão de 90% para ela e 10% para o NutriAli, baixa pelo aviso do Asaas e o painel Financeiro.
// O Asaas e o banco são simulados: nada externo é chamado.
const assert = require('node:assert/strict');
const { createFirestore, loadLib } = require('./fakes.cjs');

const context = loadLib(['premium.ts', 'asaas-client.ts', 'consultation-payments.ts', 'asaas.ts'], {
  Intl,
  process: { env: { ASAAS_WEBHOOK_TOKEN: 'token-do-webhook-de-teste-123' } },
});
const lib = new Proxy({}, { get: (_, name) => require('node:vm').runInContext(String(name), context) });
// Objetos criados dentro do contexto isolado têm outro protótipo: compara pelo conteúdo.
const plain = (value) => JSON.parse(JSON.stringify(value));

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

const NOW = new Date('2026-10-29T15:00:00.000Z');
const WALLET = '0f3c2a1b-1234-4abc-9def-0123456789ab';
const APPOINTMENT = { id: 'man_1', patientName: 'Ana Souza', patientUid: 'p1', nutritionistId: 'n1', date: '2026-11-10', time: '14:30', status: 'Agendada', source: 'manual', type: 'Retorno' };

async function setup() {
  const fake = createFirestore();
  const { db } = fake;
  await db.collection('patients').doc('p1').set({ name: 'Ana Souza', nutritionistId: 'n1' });
  // Marcada pela Ali: a lista não traz o paciente; quem diz de quem é a consulta é o registro em aliAppointments.
  const ali = { id: 'evt_ali', patientName: 'Ana Souza', date: '2026-11-12', time: '09:00', status: 'Agendada', source: 'ali', type: 'Retorno' };
  const aliOther = { ...ali, id: 'evt_outro' };
  await db.collection('users').doc('n1').set({ appointments: [APPOINTMENT, { ...APPOINTMENT, id: 'man_2', patientUid: 'p9' }, ali, aliOther] });
  await db.collection('aliAppointments').doc('n1_evt_ali').set({ eventId: 'evt_ali', nutritionistId: 'n1', patientUid: 'p1', status: 'scheduled' });
  await db.collection('aliAppointments').doc('n1_evt_outro').set({ eventId: 'evt_outro', nutritionistId: 'n1', patientUid: 'p9', status: 'scheduled' });
  await db.collection('users').doc('p1').set({ appointments: [APPOINTMENT] });
  return fake;
}

let count = 0;
async function check(name, fn) { await fn(); count++; }

(async () => {
  await check('preço, divisão e CNPJ: aceita "150,00" e "1.500,00", recusa fora da faixa e divide sem perder centavo', () => {
    assert.equal(lib.validPrice('150,00'), 150);
    assert.equal(lib.validPrice('1.500,00'), 1500);
    assert.equal(lib.validPrice('150.00'), 150);
    assert.equal(lib.validPrice('R$ 99,90'), 99.9);
    assert.equal(lib.validPrice(9.99), null);
    assert.equal(lib.validPrice('5001'), null);
    assert.equal(lib.validPrice('abc'), null);
    assert.deepEqual(plain(lib.splitValue(100)), { nutritionist: 90, commission: 10 });
    assert.deepEqual(plain(lib.splitValue(150)), { nutritionist: 135, commission: 15 });
    assert.deepEqual(plain(lib.splitValue(99.99)), { nutritionist: 89.99, commission: 10 });
    assert.equal(lib.validCnpj('11.222.333/0001-81'), '11222333000181');
    assert.equal(lib.validCnpj('11.222.333/0001-82'), null);
    assert.equal(lib.validCnpj('00.000.000/0000-00'), null);
  });

  await check('preço e carteira: só recebe pelo app com os dois; Wallet ID com formato errado é recusado', async () => {
    const { db } = createFirestore();
    assert.equal(lib.paymentsEnabled(await lib.loadPaymentSettings(db, 'n1')), false);
    assert.equal((await lib.savePrice(db, 'n1', '5', NOW)).status, 422);
    assert.equal((await lib.savePrice(db, 'n1', '180,00', NOW)).price, 180);
    assert.equal(lib.paymentsEnabled(await lib.loadPaymentSettings(db, 'n1')), false);
    assert.equal((await lib.linkWallet(db, 'n1', 'carteira-qualquer', NOW)).status, 422);
    assert.equal((await lib.linkWallet(db, 'n1', WALLET.toUpperCase(), NOW)).ok, true);
    const settings = await lib.loadPaymentSettings(db, 'n1');
    assert.deepEqual(plain(settings), { consultationPrice: 180, walletId: WALLET, subaccountId: null });
    assert.equal(lib.paymentsEnabled(settings), true);
  });

  await check('subconta: confere os dados, manda ao Asaas sem guardar CPF e endereço, e não cria duas vezes', async () => {
    const { db, store } = createFirestore();
    const asaas = fakeAsaas({ 'POST /accounts': { id: 'acc_1', walletId: WALLET, accessToken: { apiKey: 'chave-que-nao-fica' } } });
    const owner = { name: 'Dra. Carla Mendes', email: 'carla@exemplo.com' };
    const base = { document: '529.982.247-25', birthDate: '1990-05-20', mobilePhone: '(11) 98888-7777', incomeValue: '8.000,00', postalCode: '01310-100', address: 'Av. Paulista', addressNumber: '1000', province: 'Bela Vista' };
    assert.equal((await lib.createSubaccount(db, 'n1', owner, { ...base, document: '123' }, asaas.request, NOW)).status, 422);
    assert.equal((await lib.createSubaccount(db, 'n1', owner, { ...base, birthDate: '2015-01-01' }, asaas.request, NOW)).status, 422);
    assert.equal((await lib.createSubaccount(db, 'n1', owner, { ...base, postalCode: '123' }, asaas.request, NOW)).status, 422);
    assert.equal((await lib.createSubaccount(db, 'n1', owner, { ...base, address: '' }, asaas.request, NOW)).status, 422);
    assert.equal((await lib.createSubaccount(db, 'n1', owner, { ...base, document: '11.222.333/0001-81' }, asaas.request, NOW)).status, 422, 'CNPJ pede o tipo da empresa');
    assert.equal(asaas.calls.length, 0);

    assert.equal((await lib.createSubaccount(db, 'n1', owner, base, asaas.request, NOW)).ok, true);
    assert.deepEqual(plain(asaas.calls[0].body), {
      name: 'Dra. Carla Mendes', email: 'carla@exemplo.com', cpfCnpj: '52998224725', birthDate: '1990-05-20',
      mobilePhone: '11988887777', incomeValue: 8000, postalCode: '01310-100', address: 'Av. Paulista', addressNumber: '1000', province: 'Bela Vista',
    });
    const saved = store.get('nutritionistPayments/n1');
    assert.equal(saved.walletId, WALLET);
    assert.equal(saved.subaccountId, 'acc_1');
    assert.equal(JSON.stringify(saved).includes('52998224725') || JSON.stringify(saved).includes('chave-que-nao-fica') || JSON.stringify(saved).includes('Paulista'), false);
    assert.equal((await lib.createSubaccount(db, 'n1', owner, base, asaas.request, NOW)).status, 409);

    // Empresa: CNPJ com o tipo, sem data de nascimento.
    const other = createFirestore();
    const asaas2 = fakeAsaas({ 'POST /accounts': { id: 'acc_2', walletId: WALLET } });
    assert.equal((await lib.createSubaccount(other.db, 'n2', owner, { ...base, document: '11.222.333/0001-81', companyType: 'MEI', birthDate: '' }, asaas2.request, NOW)).ok, true);
    assert.equal(asaas2.calls[0].body.companyType, 'MEI');
    assert.equal('birthDate' in asaas2.calls[0].body, false);
  });

  await check('pagar a consulta: só com a nutricionista recebendo, pede CPF na primeira vez e cobra com 90% para a carteira dela', async () => {
    const { db, store } = await setup();
    const asaas = fakeAsaas({
      'POST /customers': { id: 'cus_1' },
      'POST /payments': { id: 'pay_c1', invoiceUrl: 'https://asaas.test/i/pay_c1', status: 'PENDING' },
    });
    const off = await lib.startConsultationPayment(db, 'p1', 'ana@exemplo.com', { appointmentId: 'man_1' }, asaas.request, NOW);
    assert.equal(off.status, 409);
    assert.deepEqual(plain(await lib.patientPaymentInfo(db, 'p1')), { enabled: false, price: null });

    await lib.savePrice(db, 'n1', 150, NOW);
    await lib.linkWallet(db, 'n1', WALLET, NOW);
    assert.deepEqual(plain(await lib.patientPaymentInfo(db, 'p1')), { enabled: true, price: 150 });

    const noCpf = await lib.startConsultationPayment(db, 'p1', 'ana@exemplo.com', { appointmentId: 'man_1' }, asaas.request, NOW);
    assert.equal(noCpf.status, 422);
    assert.equal(noCpf.needCpf, true);

    const paid = await lib.startConsultationPayment(db, 'p1', 'ana@exemplo.com', { appointmentId: 'man_1', cpf: '529.982.247-25' }, asaas.request, NOW);
    assert.deepEqual(plain(paid), { ok: true, invoiceUrl: 'https://asaas.test/i/pay_c1' });
    const charge = asaas.calls.find((call) => call.path === '/payments');
    assert.deepEqual(plain(charge.body), {
      customer: 'cus_1', billingType: 'UNDEFINED', value: 150, dueDate: '2026-11-01',
      description: 'Consulta nutricional em 10/11/2026 às 14:30', externalReference: 'consulta:n1_man_1',
      split: [{ walletId: WALLET, percentualValue: 90 }],
    });
    const record = store.get('consultationPayments/n1_man_1');
    assert.equal(record.status, 'pending');
    assert.equal(record.value, 150);
    assert.equal(record.patientUid, 'p1');
    assert.deepEqual(store.get('users/p1').appointments[0].payment, { status: 'pending', value: 150 });
    assert.deepEqual(store.get('users/n1').appointments[0].payment, { status: 'pending', value: 150 });
    assert.equal(store.get('users/n1').appointments[1].payment, undefined);

    // Voltou sem pagar: o mesmo link, sem outra cobrança.
    const again = await lib.startConsultationPayment(db, 'p1', 'ana@exemplo.com', { appointmentId: 'man_1' }, asaas.request, NOW);
    assert.equal(again.invoiceUrl, 'https://asaas.test/i/pay_c1');
    assert.equal(asaas.calls.filter((call) => call.path === '/payments').length, 1);

    // Consulta que não é dele ou que não existe na lista da nutricionista: recusa.
    assert.equal((await lib.startConsultationPayment(db, 'p1', 'ana@exemplo.com', { appointmentId: 'man_2' }, asaas.request, NOW)).status, 404);
    assert.equal((await lib.startConsultationPayment(db, 'p1', 'ana@exemplo.com', { appointmentId: 'inventada' }, asaas.request, NOW)).status, 404);
    assert.equal((await lib.startConsultationPayment(db, 'p1', 'ana@exemplo.com', {}, asaas.request, NOW)).status, 400);
    // Consulta da Ali: vale o registro da agenda da Ali.
    assert.equal((await lib.startConsultationPayment(db, 'p1', 'ana@exemplo.com', { appointmentId: 'evt_ali' }, asaas.request, NOW)).ok, true);
    assert.equal(asaas.calls.filter((call) => call.path === '/payments').at(-1).body.externalReference, 'consulta:n1_evt_ali');
    assert.equal((await lib.startConsultationPayment(db, 'p1', 'ana@exemplo.com', { appointmentId: 'evt_outro' }, asaas.request, NOW)).status, 404);
  });

  await check('aviso do Asaas: confere o pagamento, dá a consulta como paga nas duas listas e o Financeiro mostra os 90% e os 10%', async () => {
    const { db, store } = await setup();
    await lib.savePrice(db, 'n1', 150, NOW);
    await lib.linkWallet(db, 'n1', WALLET, NOW);
    await db.collection('billing').doc('p1').set({ asaasCustomerId: 'cus_1' });
    const asaas = fakeAsaas({
      'POST /payments': { id: 'pay_c1', invoiceUrl: 'https://asaas.test/i/pay_c1' },
      'GET /payments/pay_c1': { id: 'pay_c1', status: 'RECEIVED', externalReference: 'consulta:n1_man_1', value: 150, netValue: 146.01, dueDate: '2026-11-01' },
    });
    await lib.startConsultationPayment(db, 'p1', 'ana@exemplo.com', { appointmentId: 'man_1' }, asaas.request, NOW);

    const paidAt = new Date('2026-10-30T12:00:00.000Z');
    assert.equal(await lib.handleAsaasEvent(db, { id: 'evt_c1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_c1' } }, asaas.request, paidAt), 'consulta paga');
    const record = store.get('consultationPayments/n1_man_1');
    assert.equal(record.status, 'paid');
    assert.equal(record.netValue, 146.01);
    assert.equal(record.paidAt, paidAt.toISOString());
    assert.deepEqual(store.get('users/p1').appointments[0].payment, { status: 'paid', value: 150 });
    assert.deepEqual(store.get('users/n1').appointments[0].payment, { status: 'paid', value: 150 });
    assert.equal(await lib.handleAsaasEvent(db, { id: 'evt_c1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_c1' } }, asaas.request, paidAt), 'repetido');
    assert.equal((await lib.startConsultationPayment(db, 'p1', 'ana@exemplo.com', { appointmentId: 'man_1' }, asaas.request, paidAt)).status, 409);

    const finance = plain(await lib.nutritionistFinance(db, 'n1', paidAt));
    assert.equal(finance.price, 150);
    assert.equal(finance.enabled, true);
    // A divisão sai do valor líquido (R$ 146,01, já sem a taxa do Asaas): 90% para ela, 10% de comissão.
    assert.deepEqual(finance.month, { count: 1, gross: 150, nutritionist: 131.41, commission: 14.6 });
    assert.deepEqual(finance.total, finance.month);
    assert.equal(finance.payments.length, 1);
    assert.equal(finance.payments[0].status, 'paid');
    assert.equal(finance.payments[0].exact, true);
    // No mês seguinte, o total continua e o mês zera.
    const next = plain(await lib.nutritionistFinance(db, 'n1', new Date('2026-11-15T12:00:00.000Z')));
    assert.equal(next.month.count, 0);
    assert.equal(next.total.count, 1);

    assert.equal(await lib.handleAsaasEvent(db, { id: 'evt_c2', event: 'PAYMENT_REFUNDED', payment: { id: 'pay_c1', externalReference: 'consulta:n1_man_1' } }, asaas.request, paidAt), 'consulta estornada');
    assert.equal(store.get('consultationPayments/n1_man_1').status, 'refunded');
    assert.equal(store.get('users/n1').appointments[0].payment.status, 'refunded');
    assert.equal(plain(await lib.nutritionistFinance(db, 'n1', paidAt)).total.count, 0);
    // Cobrança de consulta que não é do app: ignorada.
    assert.equal(await lib.handleAsaasEvent(db, { id: 'evt_c3', event: 'PAYMENT_REFUNDED', payment: { id: 'x', externalReference: 'consulta:outra' } }, asaas.request, paidAt), 'ignorado');
  });

  console.log(`${count} verificações das consultas pagas e da comissão passaram. Nada externo foi chamado.`);
})().catch((error) => { console.error(error); process.exit(1); });
