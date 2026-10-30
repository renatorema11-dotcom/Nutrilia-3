// Testa os avisos por e-mail ao paciente (lib/patient-notices.ts): recado novo no chat, plano novo e resposta a
// pedido de consulta. Firestore e Gmail simulados; nenhum serviço externo é chamado.
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createFirestore, createGoogle, loadLib } = require('./fakes.cjs');

const { store, db, FieldValue } = createFirestore();
const google = createGoogle();
let failSend = 0;
const fetch = async (url, init) => {
  if (failSend > 0 && url.includes('/messages/send')) { failSend--; return { ok: false, status: 500, json: async () => ({ error: {} }) }; }
  return google.fetch(url, init);
};
const context = loadLib(['ali-settings.ts', 'agenda.ts', 'google-workspace.ts', 'patient-notices.ts'], { FieldValue, fetch });
context.db = db;
const run = (code) => vm.runInContext(code, context);
const NOW = new Date('2026-10-15T13:00:00Z');
const at = (minutes) => new Date(NOW.getTime() + minutes * 60_000);
const iso = (minutes) => at(minutes).toISOString();
const notices = (when) => { context.when = when; return run('runPatientNotices(db, when)').then((s) => JSON.parse(JSON.stringify(s))); };
const sent = () => google.sent.map((m) => [m.to, m.subject]);

let count = 0;
async function check(name, fn) { google.sent.length = 0; await fn(); count++; }

(async () => {
  store.set('users/nutri-1', { role: 'nutritionist', displayName: 'Dra. Carla Mendes' });
  store.set('nutritionistSettings/nutri-1', { ali: { displayName: 'Dra. Carla Mendes' } });
  store.set('googleConnections/nutri-1', { status: 'connected', email: 'carla@exemplo.com', refreshToken: run("encrypt(getGoogleConfig(), 'autorizacao-de-teste')") });
  store.set('users/nutri-2', { role: 'nutritionist', displayName: 'Dra. Sem Google' });
  store.set('patients/p-ana', { name: 'Ana Souza', email: 'ana@exemplo.com', nutritionistId: 'nutri-1' });
  store.set('users/p-ana', { role: 'patient' });
  store.set('patients/p-joao', { name: 'João Pereira', nutritionistId: 'nutri-1' });
  store.set('patients/p-bia', { name: 'Bia Costa', email: 'bia@exemplo.com', nutritionistId: 'nutri-1' });
  store.set('users/p-bia', { role: 'patient', emailNotices: false });
  store.set('patients/p-lia', { name: 'Lia Rocha', email: 'lia@exemplo.com', nutritionistId: 'nutri-2' });
  // Eva trocou de nutricionista: a conversa antiga (com a nutri-2) não gera aviso.
  store.set('patients/p-eva', { name: 'Eva Lima', email: 'eva@exemplo.com', nutritionistId: 'nutri-1' });
  const message = (chat, id, role, sender, minutes, text = 'Texto reservado da conversa') =>
    store.set(`chats/${chat}/messages/${id}`, { senderId: sender, senderName: role === 'patient' ? 'Paciente' : 'Dra.', senderRole: role, text, createdAt: iso(minutes) });

  await check('recado novo não lido: um e-mail depois de 10 minutos, sem o texto da mensagem', async () => {
    store.set('chats/p-ana_nutri-1', { updatedAt: at(-5) });
    message('p-ana_nutri-1', 'm1', 'nutritionist', 'nutri-1', -5);
    assert.deepEqual(await notices(NOW), { checked: 0, sent: 0, skipped: 0, failed: 0 }); // ainda dentro dos 10 minutos
    const stats = await notices(at(6));
    assert.deepEqual(stats, { checked: 1, sent: 1, skipped: 0, failed: 0 });
    assert.deepEqual(sent(), [['ana@exemplo.com', 'Nova mensagem de Dra. Carla Mendes no NutriAli']]);
    const mail = google.sent[0];
    assert.match(mail.from, /^Dra\. Carla Mendes <carla@exemplo\.com>$/);
    assert.match(mail.html, /Olá, Ana!/);
    assert.match(mail.html, /te mandou uma mensagem no chat do NutriAli/);
    assert.match(mail.html, /https:\/\/app\.nutriali\.cloud\/patient\/chat\?tab=nutritionist/);
    assert.ok(!mail.html.includes('Texto reservado'));
    assert.deepEqual([store.get('patientNotices/p-ana').chatNotifiedUpTo, store.get('patientNotices/p-ana').chatNotifiedAt], [iso(-5), iso(6)]);
    // A mesma mensagem não vira outro e-mail.
    assert.equal((await notices(at(20))).sent, 0);
  });

  await check('mais recados: no máximo um e-mail a cada 12 horas por conversa, contando as mensagens novas', async () => {
    message('p-ana_nutri-1', 'm2', 'nutritionist', 'nutri-1', 30);
    message('p-ana_nutri-1', 'm3', 'nutritionist', 'nutri-1', 31);
    store.set('chats/p-ana_nutri-1', { updatedAt: at(31) });
    assert.equal((await notices(at(60))).sent, 0); // menos de 12 horas desde o último aviso
    const later = await notices(at(6 + 12 * 60));
    assert.equal(later.sent, 1);
    assert.match(google.sent[0].html, /te mandou 2 mensagens/);
  });

  await check('leu no app ou respondeu: nada de e-mail', async () => {
    message('p-ana_nutri-1', 'm4', 'nutritionist', 'nutri-1', 24 * 60);
    store.set('chats/p-ana_nutri-1', { updatedAt: at(24 * 60) });
    store.set('users/p-ana', { role: 'patient', nutriChatReadAt: iso(24 * 60 + 2) });
    assert.equal((await notices(at(26 * 60))).sent, 0);
    message('p-ana_nutri-1', 'm5', 'nutritionist', 'nutri-1', 27 * 60);
    message('p-ana_nutri-1', 'm6', 'patient', 'p-ana', 27 * 60 + 1);
    store.set('chats/p-ana_nutri-1', { updatedAt: at(27 * 60 + 1) });
    assert.equal((await notices(at(28 * 60))).sent, 0);
  });

  await check('sem e-mail cadastrado, aviso desligado, sem Google e ex-paciente: nada sai e nada trava', async () => {
    for (const [chat, nutri] of [['p-joao_nutri-1', 'nutri-1'], ['p-bia_nutri-1', 'nutri-1'], ['p-lia_nutri-2', 'nutri-2'], ['p-eva_nutri-2', 'nutri-2']]) {
      store.set(`chats/${chat}`, { updatedAt: at(-30) });
      message(chat, 'x1', 'nutritionist', nutri, -30);
    }
    const stats = await notices(NOW);
    assert.deepEqual(stats, { checked: 4, sent: 0, skipped: 4, failed: 0 });
    assert.equal(google.sent.length, 0);
    // Já foi resolvido (pulado): na rodada seguinte não conta de novo.
    assert.deepEqual(await notices(at(10)), { checked: 0, sent: 0, skipped: 0, failed: 0 });
  });

  await check('plano novo aprovado: um e-mail por aprovação; plano em rascunho ou aprovação antiga não avisam', async () => {
    store.set('patients/p-ana', { ...store.get('patients/p-ana'), currentPlan: { status: 'approved', days: [] }, planApprovedAt: iso(-3) });
    store.set('patients/p-joao', { ...store.get('patients/p-joao'), currentPlan: { status: 'draft' }, planApprovedAt: iso(-3) });
    store.set('patients/p-bia', { ...store.get('patients/p-bia'), currentPlan: { status: 'approved' }, planApprovedAt: iso(-4 * 24 * 60) });
    const stats = await notices(NOW);
    assert.equal(stats.sent, 1);
    assert.deepEqual(sent(), [['ana@exemplo.com', 'Seu plano alimentar foi atualizado']]);
    assert.match(google.sent[0].html, /Dra\. Carla Mendes aprovou um plano alimentar novo para você/);
    assert.match(google.sent[0].html, /\/patient\/plan/);
    assert.equal((await notices(at(10))).sent, 0);
    store.set('patients/p-ana', { ...store.get('patients/p-ana'), planApprovedAt: iso(30) });
    assert.equal((await notices(at(40))).sent, 1);
  });

  await check('pedido de consulta encerrado sem marcar: avisa uma vez e cobre o recado que foi junto', async () => {
    store.set('appointmentRequests/r1', { patientUid: 'p-ana', nutritionistId: 'nutri-1', status: 'declined', declineMessage: true, preferredDate: 'sexta de manhã', answeredAt: iso(100) });
    store.set('appointmentRequests/r2', { patientUid: 'p-ana', nutritionistId: 'nutri-1', status: 'confirmed', answeredAt: iso(100) });
    store.set('appointmentRequests/r3', { patientUid: 'p-ana', nutritionistId: 'nutri-1', status: 'declined', preferredDate: 'a combinar', answeredAt: iso(101) });
    // O recado do encerramento chega ao chat junto.
    message('p-ana_nutri-1', 'm7', 'nutritionist', 'nutri-1', 100, 'Esta semana não tenho horário.');
    store.set('chats/p-ana_nutri-1', { updatedAt: at(100) });
    const stats = await notices(at(102));
    assert.equal(stats.sent, 2);
    assert.deepEqual(sent(), [['ana@exemplo.com', 'Resposta ao seu pedido de consulta'], ['ana@exemplo.com', 'Resposta ao seu pedido de consulta']]);
    assert.match(google.sent[0].html, /viu o seu pedido de consulta \(sexta de manhã\) e não conseguiu marcar/);
    assert.match(google.sent[0].html, /Tem um recado para você no chat/);
    assert.doesNotMatch(google.sent[1].html, /\(a combinar\)/);
    assert.match(google.sent[1].html, /peça outro horário pela Ali/);
    assert.ok(store.get('appointmentRequests/r1').patientNotifiedAt);
    assert.equal(store.get('appointmentRequests/r2').patientNotifiedAt, undefined);
    // O recado já foi avisado junto com a resposta: o aviso de chat não repete.
    assert.equal((await notices(at(120))).sent, 0);
  });

  await check('falha no envio: não marca como avisado e tenta de novo na próxima rodada', async () => {
    store.set('appointmentRequests/r4', { patientUid: 'p-ana', nutritionistId: 'nutri-1', status: 'declined', preferredDate: 'segunda', answeredAt: iso(200) });
    failSend = 1;
    const first = await notices(at(201));
    assert.deepEqual([first.sent, first.failed], [0, 1]);
    assert.equal(store.get('appointmentRequests/r4').patientNotifiedAt, undefined);
    const second = await notices(at(211));
    assert.equal(second.sent, 1);
    assert.ok(store.get('appointmentRequests/r4').patientNotifiedAt);
  });

  console.log(`${count} verificações dos avisos ao paciente passaram. Nenhum serviço externo foi chamado.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
