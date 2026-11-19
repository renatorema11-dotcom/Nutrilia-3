// Testa a linha do tempo do paciente (lib/patient-timeline.ts): pesagens, anotações, consultas, planos, pedidos e
// ficha, a janela de meses, o fuso, os limites e o isolamento entre nutricionistas, com o Firestore simulado.
// Nenhum serviço externo é chamado.
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createFirestore, loadLib } = require('./fakes.cjs');

const { store, db } = createFirestore();
const context = loadLib(['ali-settings.ts', 'consultation-notes.ts', 'clinical-profile.ts', 'patient-timeline.ts'], {});
const run = (code) => vm.runInContext(code, context);
const plain = (value) => JSON.parse(JSON.stringify(value));

const NUTRI = 'nutri-1';
const OTHER = 'nutri-2';
const TZ = 'America/Sao_Paulo';
// Uma terça-feira, meio-dia em Brasília: as datas dos testes ficam fixas e legíveis.
const NOW = new Date('2026-11-17T15:00:00Z');
const ANA = { uid: 'p-ana', name: 'Ana Souza' };
const timeline = async (patient, input = {}, nutri = NUTRI, timeZone = TZ) => {
  context.args = [db, nutri, patient, input, timeZone, NOW];
  return plain(await run('patientTimeline(...args)'));
};

let count = 0;
async function check(name, fn) { await fn(); count++; }

(async () => {
  const longNote = 'Paciente relata mais disposição pela manhã e melhora do sono. ' + 'Combinamos aumentar a água e trocar o lanche da tarde por fruta com iogurte natural. '.repeat(4);
  store.set('patients/p-ana', {
    name: 'Ana Souza', nutritionistId: NUTRI, createdAt: '2026-06-01T13:00:00.000Z',
    measurements: [
      { date: '2026-04-10', weight: 80 },
      { date: '2026-06-01', weight: 78, source: 'nutritionist' },
      { date: '2026-07-01', weight: 77.2 },
      { date: '2026-08-01', weight: 76.5 },
      { date: '2026-09-01', weight: 75 },
      { date: '2026-10-01', weight: 74.1 },
      { date: '2026-10-20', weight: 73 },
      { date: '2026-11-10', weight: 72.4, bodyFat: 30.5, source: 'nutritionist' },
      { date: '2026-02-31', weight: 70 }, { date: '2026-11-01', weight: '71' }, { date: 'ontem', weight: 71 }, { date: '2026-11-02', weight: -5 }, null, 'texto',
    ],
    currentPlan: { status: 'approved', createdDate: '2026-10-20', source: 'ali' }, planApprovedAt: '2026-10-21T14:00:00.000Z',
    pendingPlan: { status: 'draft', createdDate: '2026-11-12', source: 'ali' },
    pastPlans: [{ createdDate: '2026-06-05', status: 'approved' }, { createdDate: '2025-12-01', status: 'approved' }],
  });
  store.set('patients/p-joao', { name: 'João Pereira', nutritionistId: NUTRI });
  store.set('patients/p-marcos', { name: 'Marcos Lima', nutritionistId: OTHER, createdAt: '2026-10-01T12:00:00.000Z', measurements: [{ date: '2026-10-01', weight: 90 }] });
  store.set('consultationNotes/n1', { nutritionistId: NUTRI, patientUid: 'p-ana', text: longNote, createdAt: '2026-11-10T14:30:00.000Z', source: 'app' });
  store.set('consultationNotes/n2', { nutritionistId: OTHER, patientUid: 'p-ana', text: 'Segredo da outra nutricionista', createdAt: '2026-11-11T14:30:00.000Z', source: 'app' });
  store.set('aliAppointments/a1', { nutritionistId: NUTRI, patientUid: 'p-ana', status: 'scheduled', startAt: '2026-11-10T13:00:00.000Z', mode: 'online', label: 'terça-feira, 10 de novembro, às 10:00' });
  store.set('aliAppointments/a2', { nutritionistId: NUTRI, patientUid: 'p-ana', status: 'scheduled', startAt: '2026-11-24T17:00:00.000Z', mode: 'presencial', label: 'terça-feira, 24 de novembro, às 14:00' });
  store.set('aliAppointments/a3', { nutritionistId: NUTRI, patientUid: 'p-ana', status: 'cancelled', startAt: '2026-10-05T13:00:00.000Z', mode: 'online' });
  // 22:30 em Brasília do dia 3 já é dia 4 em UTC: a data vale no fuso da nutricionista.
  store.set('aliAppointments/a4', { nutritionistId: NUTRI, patientUid: 'p-ana', status: 'scheduled', startAt: '2026-11-04T01:30:00.000Z', mode: 'online' });
  store.set('aliAppointments/a5', { nutritionistId: OTHER, patientUid: 'p-ana', status: 'scheduled', startAt: '2026-11-15T13:00:00.000Z', mode: 'presencial', label: 'Consulta da outra' });
  store.set('aliAppointments/a6', { nutritionistId: NUTRI, patientUid: 'p-ana', status: 'rascunho', startAt: '2026-11-06T13:00:00.000Z' });
  store.set('appointmentRequests/r1', { nutritionistId: NUTRI, patientUid: 'p-ana', createdAt: '2026-11-05T12:00:00.000Z', status: 'confirmed', preferredDate: 'sexta de manhã' });
  store.set('appointmentRequests/r2', { nutritionistId: NUTRI, patientUid: 'p-ana', createdAt: '2026-09-10T12:00:00.000Z', status: 'pending', preferredDate: 'a combinar' });
  store.set('appointmentRequests/r3', { nutritionistId: OTHER, patientUid: 'p-ana', createdAt: '2026-11-13T12:00:00.000Z', status: 'pending', preferredDate: 'Pedido da outra' });
  store.set(`clinicalProfiles/${NUTRI}_p-ana`, { nutritionistId: NUTRI, patientUid: 'p-ana', allergies: ['amendoim'], updatedAt: '2026-11-11T12:00:00.000Z', updatedBy: 'app' });
  store.set(`clinicalProfiles/${OTHER}_p-ana`, { nutritionistId: OTHER, patientUid: 'p-ana', allergies: ['soja'], updatedAt: '2026-11-16T12:00:00.000Z', updatedBy: 'app' });

  await check('seis meses: abre com a mudança de peso e conta os eventos mais recentes, do mais novo ao mais antigo', async () => {
    const result = await timeline(ANA);
    assert.equal(result.ok, true);
    assert.equal(result.months, 6);
    assert.equal(result.since, '2026-05-17');
    assert.ok(result.speech.startsWith('Nos últimos 6 meses, Ana Souza foi de 78 para 72,4 quilos, 5,6 a menos, em 7 pesagens. '), result.speech);
    assert.match(result.speech, / Em 24 de novembro, consulta marcada, às 14:00, presencial\. Em 12 de novembro, rascunho novo de plano feito pela Ali, esperando a sua aprovação\. Em 11 de novembro, ficha clínica atualizada\. Em 10 de novembro, anotação da consulta: Paciente relata/);
    assert.match(result.speech, /; consulta online; peso de 72,4 quilos, com 30,5 por cento de gordura\. E mais 14 registros\.$/);
    assert.ok(result.speech.length <= 600, `fala com ${result.speech.length} caracteres`);
    assert.deepEqual(result.weight, { first: 78, last: 72.4, change: -5.6, measurements: 7, firstDate: '2026-06-01', lastDate: '2026-11-10' });
    assert.equal(result.total, 20);
    assert.equal(result.timeline.length, 20);
    assert.deepEqual(result.timeline.slice(0, 7).map((e) => `${e.date} ${e.kind}`), [
      '2026-11-24 consulta', '2026-11-12 plano', '2026-11-11 ficha', '2026-11-10 anotacao', '2026-11-10 consulta', '2026-11-10 peso', '2026-11-05 pedido',
    ]);
    const dates = result.timeline.map((e) => e.date);
    assert.deepEqual(dates, [...dates].sort().reverse());
    assert.ok(result.timeline.every((e) => Object.keys(e).join() === 'date,kind,text'));
    const texts = Object.fromEntries(result.timeline.map((e) => [`${e.date} ${e.kind}`, e.text]));
    assert.equal(texts['2026-11-03 consulta'], 'consulta online');
    assert.equal(texts['2026-10-05 consulta'], 'consulta cancelada');
    assert.equal(texts['2026-11-05 pedido'], 'pedido de consulta com preferência por sexta de manhã, atendido');
    assert.equal(texts['2026-09-10 pedido'], 'pedido de consulta sem data de preferência, esperando resposta');
    assert.equal(texts['2026-10-21 plano'], 'plano alimentar aprovado');
    assert.equal(texts['2026-10-20 plano'], 'plano alimentar criado, a partir do rascunho da Ali');
    assert.equal(texts['2026-06-05 plano'], 'plano alimentar criado, depois substituído');
    assert.equal(texts['2026-06-01 inicio'], 'início do acompanhamento');
    assert.equal(texts['2026-06-01 peso'], 'peso de 78 quilos');
    // A anotação vai cortada em 160 caracteres na lista e mais curta na fala.
    const note = result.timeline.find((e) => e.kind === 'anotacao');
    assert.ok(note.text.startsWith('anotação da consulta: Paciente relata') && note.text.endsWith('…'));
    assert.equal(note.text.length, 'anotação da consulta: '.length + 160);
    // O que está fora da janela, o que é inválido e o que é de outra nutricionista não aparece.
    const all = JSON.stringify(result);
    for (const absent of ['Segredo', 'outra', 'soja', '2026-04-10', '2025-12-01', '2026-11-16', '2026-11-15', '2026-11-13', '2026-11-06', '2026-02-31', '71 quilos']) assert.ok(!all.includes(absent), absent);
  });

  await check('janela de meses: 1 a 24 (texto também vale), padrão 6, fora disso pergunta de novo', async () => {
    const month = await timeline(ANA, { months: 1 });
    assert.equal(month.since, '2026-10-17');
    assert.ok(month.speech.startsWith('No último mês, Ana Souza foi de 73 para 72,4 quilos, 0,6 a menos, em 2 pesagens.'), month.speech);
    assert.ok(month.timeline.every((e) => e.date >= '2026-10-17'));
    assert.ok(!month.timeline.some((e) => e.text === 'consulta cancelada'));
    const year = await timeline(ANA, { months: '12' });
    assert.equal(year.since, '2025-11-17');
    assert.equal(year.weight.first, 80);
    assert.equal(year.weight.measurements, 8);
    assert.ok(year.timeline.some((e) => e.date === '2025-12-01' && e.kind === 'plano'));
    assert.equal((await timeline(ANA, { months: null })).months, 6);
    assert.equal((await timeline(ANA, undefined)).months, 6);
    for (const months of [0, 25, 30, 2.5, -1, 'abc', '6 meses', true, [6]]) {
      const bad = await timeline(ANA, { months });
      assert.equal(bad.status, 422, String(months));
      assert.match(bad.speech, /de 1 a 24 meses/);
    }
  });

  await check('isolamento: paciente de outra nutricionista, inexistente ou com id estranho dá 404', async () => {
    for (const [patient, nutri] of [[{ uid: 'p-marcos', name: 'Marcos Lima' }, NUTRI], [ANA, OTHER], [{ uid: 'p-nao-existe', name: 'Fulano' }, NUTRI], [{ uid: 'patients/p-ana', name: 'Ana' }, NUTRI], [{ uid: '', name: '' }, NUTRI], [null, NUTRI]]) {
      const result = await timeline(patient, {}, nutri);
      assert.equal(result.status, 404);
      assert.ok(!JSON.stringify(result).includes('90 quilos') && !JSON.stringify(result).includes('72,4'));
    }
  });

  await check('sem nada no período: diz que não há registros', async () => {
    const empty = await timeline({ uid: 'p-joao', name: 'João Pereira' });
    assert.equal(empty.ok, true);
    assert.equal(empty.speech, 'Nos últimos 6 meses, não há nenhum registro de João Pereira.');
    assert.deepEqual(empty.timeline, []);
    assert.equal(empty.weight, null);
    assert.equal(empty.total, 0);
    // Sem nome na chamada, usa o do prontuário.
    assert.equal((await timeline({ uid: 'p-joao', name: '' })).speech, 'Nos últimos 6 meses, não há nenhum registro de João Pereira.');
  });

  await check('frases de peso: uma pesagem, ganho, peso igual e eventos sem pesagem', async () => {
    store.set('patients/p-bia', { name: 'Bia Rocha', nutritionistId: NUTRI, measurements: [{ date: '2025-12-20', weight: 60 }] });
    const one = await timeline({ uid: 'p-bia', name: 'Bia Rocha' }, { months: 12 });
    assert.equal(one.speech, 'Nos últimos 12 meses, Bia Rocha teve uma pesagem: 60 quilos, em 20 de dezembro de 2025. Em 20 de dezembro de 2025, peso de 60 quilos.');
    assert.deepEqual(one.weight, { first: 60, last: 60, change: 0, measurements: 1, firstDate: '2025-12-20', lastDate: '2025-12-20' });

    store.set('patients/p-bia', { name: 'Bia Rocha', nutritionistId: NUTRI, measurements: [{ date: '2026-11-01', weight: 61.5 }, { date: '2026-10-01', weight: 60 }] });
    assert.ok((await timeline({ uid: 'p-bia', name: 'Bia Rocha' })).speech.startsWith('Nos últimos 6 meses, Bia Rocha foi de 60 para 61,5 quilos, 1,5 a mais, em 2 pesagens.'));

    store.set('patients/p-bia', { name: 'Bia Rocha', nutritionistId: NUTRI, measurements: [{ date: '2026-10-01', weight: 60 }, { date: '2026-11-01', weight: 60.04 }] });
    assert.ok((await timeline({ uid: 'p-bia', name: 'Bia Rocha' })).speech.startsWith('Nos últimos 6 meses, Bia Rocha manteve 60 quilos, em 2 pesagens.'));

    // Plano em rascunho e plano aprovado no mesmo dia em que foi criado.
    store.set('patients/p-bia', { name: 'Bia Rocha', nutritionistId: NUTRI, currentPlan: { status: 'draft', createdDate: '2026-11-02' } });
    const draft = await timeline({ uid: 'p-bia', name: 'Bia Rocha' });
    assert.equal(draft.speech, 'Nos últimos 6 meses, Bia Rocha não teve pesagens registradas. Em 2 de novembro, rascunho de plano, esperando a sua aprovação.');
    store.set('patients/p-bia', { name: 'Bia Rocha', nutritionistId: NUTRI, currentPlan: { status: 'approved', createdDate: '2026-11-02' }, planApprovedAt: '2026-11-02T20:00:00.000Z' });
    assert.deepEqual((await timeline({ uid: 'p-bia', name: 'Bia Rocha' })).timeline, [{ date: '2026-11-02', kind: 'plano', text: 'plano alimentar aprovado' }]);
  });

  await check('limites: no máximo 60 eventos na lista e fala curta mesmo com muitas anotações longas', async () => {
    const measurements = Array.from({ length: 100 }, (_, i) => ({ date: new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10), weight: 70 }));
    store.set('patients/p-many', { name: 'Carla Dias', nutritionistId: NUTRI, measurements });
    for (let i = 0; i < 6; i++) store.set(`consultationNotes/many-${i}`, { nutritionistId: NUTRI, patientUid: 'p-many', text: 'x'.repeat(3000), createdAt: `2026-11-${String(10 + i).padStart(2, '0')}T12:00:00.000Z` });
    const result = await timeline({ uid: 'p-many', name: 'Carla Dias' });
    assert.equal(result.total, 106);
    assert.equal(result.timeline.length, 60);
    assert.equal(result.weight.measurements, 100);
    assert.ok(result.speech.startsWith('Nos últimos 6 meses, Carla Dias manteve 70 quilos, em 100 pesagens.'));
    assert.ok(result.speech.length <= 600, `fala com ${result.speech.length} caracteres`);
    const told = (result.speech.match(/ Em \d/g) || []).length;
    assert.ok(told >= 1 && told <= 6);
    assert.match(result.speech, new RegExp(`E mais ${106 - told} registros\\.$`));
  });

  await check('dados estranhos no banco e fuso inválido não derrubam a linha do tempo', async () => {
    store.set('patients/p-odd', {
      name: 42, nutritionistId: NUTRI, createdAt: 12345, measurements: 'muitos', currentPlan: 'aprovado', pendingPlan: [1],
      pastPlans: { a: 1 }, planApprovedAt: {},
    });
    store.set('aliAppointments/odd1', { nutritionistId: NUTRI, patientUid: 'p-odd', status: 'scheduled', startAt: 'amanhã' });
    store.set('aliAppointments/odd2', { nutritionistId: NUTRI, patientUid: 'p-odd', status: 'scheduled', startAt: '2026-11-01T12:00:00.000Z', mode: { x: 1 } });
    store.set('appointmentRequests/odd3', { nutritionistId: NUTRI, patientUid: 'p-odd', createdAt: null, status: 'pending' });
    store.set('appointmentRequests/odd4', { nutritionistId: NUTRI, patientUid: 'p-odd', createdAt: '2026-11-02T12:00:00.000Z', status: 7, preferredDate: { a: 1 } });
    store.set('consultationNotes/odd5', { nutritionistId: NUTRI, patientUid: 'p-odd', text: 'Anotação sem data' });
    store.set(`clinicalProfiles/${NUTRI}_p-odd`, { nutritionistId: NUTRI, patientUid: 'p-odd', updatedAt: 'quando der' });
    const result = await timeline({ uid: 'p-odd', name: '' }, {}, NUTRI, 'Fuso/Inexistente');
    assert.equal(result.ok, true);
    assert.deepEqual(result.timeline, [
      { date: '2026-11-02', kind: 'pedido', text: 'pedido de consulta sem data de preferência' },
      { date: '2026-11-01', kind: 'consulta', text: 'consulta' },
    ]);
    assert.equal(result.speech, 'Nos últimos 6 meses, o paciente não teve pesagens registradas. Em 2 de novembro, pedido de consulta sem data de preferência. Em 1º de novembro, consulta.');
  });

  console.log(count + ' verificações da linha do tempo do paciente passaram. Nenhum serviço externo foi chamado.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
