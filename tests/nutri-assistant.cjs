// Testa a Ali da nutricionista (pacientes, agenda, consultas, compromissos, e-mails e contatos)
// com Firestore, Agenda e Gmail simulados. Nenhum serviço externo é chamado.
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createFirestore, createGoogle, loadLib } = require('./fakes.cjs');

const { store, db, FieldValue } = createFirestore();
const google = createGoogle();
const context = loadLib(['ali-settings.ts', 'agenda.ts', 'google-workspace.ts', 'appointments.ts', 'nutritionist-assistant.ts'], { FieldValue, fetch: google.fetch });
context.db = db;
const run = (code) => vm.runInContext(code, context);
const call = (fn, input, extra = '') => { context.input = input; return run(`${fn}(db, 'nutri-1', input${extra})`); };

const NUTRI = 'nutri-1';
let count = 0;
async function check(name, fn) { await fn(); count++; }

// Uma terça-feira às 10:00 (Brasília): as datas dos testes ficam fixas e legíveis.
const NOW = new Date('2026-10-13T13:00:00Z');
context.now = NOW;

(async () => {
  store.set(`users/${NUTRI}`, { role: 'nutritionist', displayName: 'Dra. Carla Mendes' });
  store.set(`nutritionistSettings/${NUTRI}`, {
    ali: { displayName: 'Dra. Carla Mendes', workDays: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '18:00', durationMinutes: 50, intervalMinutes: 10, minNoticeHours: 12, horizonDays: 21, mode: 'online' },
    contacts: [{ name: 'Laboratório Vida', email: 'contato@labvida.exemplo' }, { name: 'Dr. Paulo Reis', email: 'paulo@clinica.exemplo' }],
  });
  store.set(`googleConnections/${NUTRI}`, { status: 'connected', email: 'carla@exemplo.com', refreshToken: run("encrypt(getGoogleConfig(), 'autorizacao-de-teste')") });
  store.set('patients/p-ana', { name: 'Ana Souza', email: 'ana@exemplo.com', nutritionistId: NUTRI, objective: 'Emagrecimento', weight: 72.4, targetWeight: 65, currentPlan: { status: 'approved' }, nextAppointment: '' });
  store.set('patients/p-ana2', { name: 'Ana Paula Lima', email: 'anapaula@exemplo.com', nutritionistId: NUTRI, objective: 'Hipertrofia', currentPlan: { status: 'draft' } });
  store.set('patients/p-joao', { name: 'João Pereira', nutritionistId: NUTRI, objective: 'Saúde' });
  store.set('patients/p-outro', { name: 'Marcos de Outra Nutri', email: 'marcos@exemplo.com', nutritionistId: 'nutri-2' });
  store.set('users/p-ana', { role: 'patient' });

  await check('nomes falados: acento, pedaço do nome e ambiguidade', async () => {
    context.people = [{ name: 'Ana Souza' }, { name: 'Ana Paula Lima' }, { name: 'João Pereira' }, { name: 'Laboratório Vida' }];
    const names = (spoken) => { context.spoken = spoken; return Array.from(run('matchByName(people, spoken)'), (x) => x.name); };
    assert.deepEqual(names('joao'), ['João Pereira']);
    assert.deepEqual(names('a Ana Souza'), ['Ana Souza']);
    assert.deepEqual(names('Ana'), ['Ana Souza', 'Ana Paula Lima']);
    assert.deepEqual(names('laboratorio vida'), ['Laboratório Vida']);
    assert.deepEqual(names('Dra. Ana Paula'), ['Ana Paula Lima']);
    assert.deepEqual(names('perei'), ['João Pereira']);
    assert.deepEqual(names('Carlos'), []);
    assert.deepEqual(names('de'), []);
  });

  await check('contatos: só nome e e-mail válidos, sem repetir', async () => {
    context.raw = [{ name: ' Lab  Vida ', email: 'Contato@LabVida.exemplo' }, { name: 'Repetido', email: 'contato@labvida.exemplo' }, { name: 'Sem e-mail', email: 'nada' }, { name: '', email: 'a@b.co' }, 'texto'];
    assert.deepEqual(JSON.parse(run('JSON.stringify(sanitizeContacts(raw))')), [{ name: 'Lab Vida', email: 'contato@labvida.exemplo' }]);
  });

  await check('datas faladas viram horário de Brasília; data impossível é recusada', async () => {
    const at = (date, time) => { context.d = date; context.t = time; const r = run("parseLocalDateTime(d, t, 'America/Sao_Paulo')"); return r && r.toISOString(); };
    assert.equal(at('2026-10-15', '14:30'), '2026-10-15T17:30:00.000Z');
    assert.equal(at('2026-10-15', '9h'), '2026-10-15T12:00:00.000Z');
    assert.equal(at('2026-10-15', '14h30'), '2026-10-15T17:30:00.000Z');
    assert.equal(at('2026-02-31', '10:00'), null);
    assert.equal(at('amanhã', '10:00'), null);
    assert.equal(at('2026-10-15', '25:00'), null);
  });

  await check('pacientes: só os dela, em ordem, e busca por nome', async () => {
    const all = await call('listPatients', undefined);
    assert.match(all.speech, /^Você tem 3 pacientes: Ana Paula Lima, Ana Souza e João Pereira\.$/);
    assert.ok(!JSON.stringify(all).includes('Marcos'));
    const found = await call('listPatients', 'joão');
    assert.match(found.speech, /Encontrei 1 paciente: João Pereira/);
  });

  await check('resumo do paciente e pedido de qual quando o nome é ambíguo', async () => {
    const ambiguous = await call('patientSummary', 'Ana');
    assert.equal(ambiguous.status, 409);
    assert.match(ambiguous.speech, /Ana Souza e Ana Paula Lima|Ana Paula Lima e Ana Souza/);
    const summary = await call('patientSummary', 'Ana Souza');
    assert.match(summary.speech, /objetivo Emagrecimento; peso atual 72.4 quilos, meta 65 quilos; plano aprovado; próxima consulta não agendada; tem e-mail cadastrado/);
    assert.equal((await call('patientSummary', 'Marcos')).status, 404);
  });

  await check('marcar consulta: cria na agenda, registra para os lembretes e avisa só o paciente', async () => {
    const result = await call('scheduleConsultation', { patientName: 'Ana Souza', date: '2026-10-15', time: '14h' }, ', now');
    assert.equal(result.ok, true);
    assert.match(result.speech, /Marquei a consulta de Ana Souza para quinta-feira, 15 de outubro, às 14:00, online/);
    assert.equal(google.lastEvent.start.dateTime, '2026-10-15T14:00:00-03:00');
    assert.equal(google.lastEvent.end.dateTime, '2026-10-15T14:50:00-03:00');
    assert.equal(google.lastEvent.attendees[0].email, 'ana@exemplo.com');
    const record = store.get(`aliAppointments/${NUTRI}_${google.lastEvent.id}`);
    assert.equal(record.patientUid, 'p-ana');
    assert.deepEqual(record.reminders, { day: 'pending', hour: 'pending' });
    assert.match(store.get('patients/p-ana').nextAppointment, /15 de outubro/);
    assert.deepEqual(google.sent.map((m) => m.to), ['ana@exemplo.com']);
  });

  await check('horário ocupado pede confirmação; com "marque assim mesmo" passa', async () => {
    google.busy = [{ start: '2026-10-16T13:00:00Z', end: '2026-10-16T14:00:00Z' }];
    const before = google.created;
    const warned = await call('scheduleConsultation', { patientName: 'João Pereira', date: '2026-10-16', time: '10:30' }, ', now');
    assert.equal(warned.status, 409);
    assert.match(warned.speech, /mesmo assim/);
    assert.equal(google.created, before);
    const forced = await call('scheduleConsultation', { patientName: 'João Pereira', date: '2026-10-16', time: '10:30', force: true }, ', now');
    assert.equal(forced.ok, true);
    assert.match(forced.speech, /não tem e-mail cadastrado/);
    google.busy = [];
  });

  await check('horário que já passou, data inválida e paciente de outra nutricionista são recusados', async () => {
    assert.equal((await call('scheduleConsultation', { patientName: 'Ana Souza', date: '2026-10-13', time: '09:00' }, ', now')).status, 422);
    assert.equal((await call('scheduleConsultation', { patientName: 'Ana Souza', date: 'quinta', time: '09:00' }, ', now')).status, 422);
    assert.equal((await call('scheduleConsultation', { patientName: 'Marcos', date: '2026-10-15', time: '09:00' }, ', now')).status, 404);
  });

  await check('agenda do dia e de vários dias', async () => {
    const day = await call('agenda', { date: '2026-10-15' }, ', now');
    assert.match(day.speech, /^Em quinta-feira, 15 de outubro, você tem 1 compromisso: às 14:00, Consulta nutricional — Ana Souza\.$/);
    const week = await call('agenda', { date: '2026-10-15', days: 3 }, ', now');
    assert.match(week.speech, /você tem 2 compromissos: quinta-feira, às 14:00, Consulta nutricional — Ana Souza; sexta-feira, às 10:30, Consulta nutricional — João Pereira/);
    const empty = await call('agenda', {}, ', now');
    assert.match(empty.speech, /nenhum compromisso em terça-feira, 13 de outubro/);
  });

  await check('compromisso livre com convidado salvo e Meet', async () => {
    google.sent.length = 0;
    const result = await call('createEvent', { title: 'Reunião com o laboratório', date: '2026-10-20', time: '15:00', durationMinutes: 30, guest: 'laboratório vida', online: true }, ', now');
    assert.equal(result.ok, true);
    assert.match(result.speech, /Marquei Reunião com o laboratório para terça-feira, 20 de outubro, às 15:00, com convite para Laboratório Vida/);
    assert.equal(google.lastEvent.end.dateTime, '2026-10-20T15:30:00-03:00');
    assert.equal(google.lastEvent.attendees[0].email, 'contato@labvida.exemplo');
    assert.ok(google.lastEvent.conferenceData);
    assert.match(google.lastEvent.query, /sendUpdates=all/);
    // Não é consulta: não entra nos lembretes de paciente.
    assert.equal(store.has(`aliAppointments/${NUTRI}_${google.lastEvent.id}`), false);
    assert.equal((await call('createEvent', { title: 'Visita', date: '2026-10-20', time: '09:00', guest: 'João Pereira' }, ', now')).status, 422);
    assert.equal((await call('createEvent', { title: 'Visita', date: '2026-10-20', time: '09:00', guest: 'Fulano Desconhecido' }, ', now')).status, 404);
    assert.equal((await call('createEvent', { date: '2026-10-20', time: '09:00' }, ', now')).status, 422);
  });

  await check('cancelar a consulta de um paciente libera a agenda e avisa o paciente', async () => {
    google.sent.length = 0;
    context.name = 'Ana Souza';
    const result = await run("cancelConsultation(db, 'nutri-1', name, now)");
    assert.equal(result.ok, true);
    assert.match(result.speech, /Consulta de Ana Souza de quinta-feira, 15 de outubro, às 14:00 cancelada/);
    assert.equal(google.deleted.length, 1);
    assert.deepEqual(google.sent.map((m) => [m.to, m.subject.split(':')[0]]), [['ana@exemplo.com', 'Consulta cancelada']]);
    assert.equal((await run("cancelConsultation(db, 'nutri-1', name, now)")).status, 409);
  });

  await check('e-mail: só para pacientes dela e contatos salvos, pelo Gmail dela', async () => {
    google.sent.length = 0;
    const sent = await call('sendEmail', { to: 'Ana Souza', subject: 'Exame de sangue', body: 'Oi, Ana!\n\nNão esqueça de levar o exame <hemograma> na quinta.\nAté lá.' }, ', now');
    assert.equal(sent.ok, true);
    assert.equal(sent.speech, 'E-mail enviado para Ana Souza.');
    assert.equal(google.sent[0].to, 'ana@exemplo.com');
    assert.equal(google.sent[0].subject, 'Exame de sangue');
    assert.match(google.sent[0].from, /^Dra\. Carla Mendes <carla@exemplo\.com>$/);
    assert.match(google.sent[0].html, /&lt;hemograma&gt; na quinta\.<br>Até lá\./);
    assert.equal((await call('sendEmail', { to: 'Dr. Paulo', subject: 'Encaminhamento', body: 'Segue o encaminhamento.' }, ', now')).ok, true);
    assert.equal(google.sent[1].to, 'paulo@clinica.exemplo');
    // Endereço ditado, paciente de outra nutricionista e paciente sem e-mail não passam.
    assert.equal((await call('sendEmail', { to: 'alguem@fora.com', subject: 'Oi', body: 'Mensagem' }, ', now')).status, 404);
    assert.equal((await call('sendEmail', { to: 'Marcos', subject: 'Oi', body: 'Mensagem' }, ', now')).status, 404);
    assert.equal((await call('sendEmail', { to: 'João Pereira', subject: 'Oi', body: 'Mensagem' }, ', now')).status, 422);
    assert.equal((await call('sendEmail', { to: 'Ana Souza', subject: '', body: 'Mensagem' }, ', now')).status, 422);
    assert.equal((await call('sendEmail', { to: 'Ana Souza', subject: 'Oi', body: '' }, ', now')).status, 422);
    assert.equal(google.sent.length, 2);
  });

  await check('limite diário de e-mails', async () => {
    store.set(`aliUsage/${NUTRI}`, { day: '2026-10-13', emails: 40 });
    const blocked = await call('sendEmail', { to: 'Ana Souza', subject: 'Oi', body: 'Mensagem' }, ', now');
    assert.equal(blocked.status, 429);
    store.set(`aliUsage/${NUTRI}`, { day: '2026-10-12', emails: 40 });
    assert.equal((await call('sendEmail', { to: 'Ana Souza', subject: 'Oi', body: 'Mensagem' }, ', now')).ok, true);
    assert.deepEqual([store.get(`aliUsage/${NUTRI}`).day, store.get(`aliUsage/${NUTRI}`).emails], ['2026-10-13', 1]);
  });

  await check('contatos e contexto da conversa', async () => {
    assert.match((await run("listContacts(db, 'nutri-1')")).speech, /2 contatos salvos: Laboratório Vida e Dr\. Paulo Reis/);
    const { dateInfo, ...vars } = await run("assistantContext(db, 'nutri-1', now)");
    // Calendário pronto para a Ali: ela copia a data em vez de calcular.
    assert.match(dateInfo, /^Agora são 10:00 de terça-feira, 13 de outubro de 2026\. Datas: hoje, terça-feira, 13 de outubro = 2026-10-13; amanhã, quarta-feira, 14 de outubro = 2026-10-14; quinta-feira, 15 de outubro = 2026-10-15; /);
    assert.match(dateInfo, /; terça-feira, 27 de outubro = 2026-10-27\.$/);
    assert.equal(dateInfo.split(' = ').length - 1, 15);
    context.late = new Date('2026-11-01T01:30:00Z');
    assert.match(run("describeDates(late, 'America/Sao_Paulo', 1)"), /^Agora são 22:30 de sábado, 31 de outubro de 2026\. Datas: hoje, sábado, 31 de outubro = 2026-10-31; amanhã, domingo, 1 de novembro = 2026-11-01\.$/);
    assert.deepEqual({ ...vars }, {
      nutritionistName: 'Dra. Carla Mendes', patientCount: '3',
      attendanceInfo: 'segunda a sexta, das 08:00 às 18:00, consultas de 50 minutos, online, pelo Google Meet',
      clinicInfo: 'Nenhuma informação do consultório cadastrada.', googleStatus: 'conectado',
    });
    context.list = [{ name: 'Novo Contato', email: 'novo@exemplo.com' }, { name: 'Inválido', email: 'x' }];
    assert.equal((await run("saveContacts(db, 'nutri-1', list)")).length, 1);
    assert.equal(store.get(`nutritionistSettings/${NUTRI}`).ali.displayName, 'Dra. Carla Mendes');
  });

  await check('sem Google conectado, a Ali explica onde conectar', async () => {
    store.set('users/nutri-3', { role: 'nutritionist', displayName: 'Sem Google' });
    store.set('patients/p-x', { name: 'Paciente X', email: 'x@exemplo.com', nutritionistId: 'nutri-3' });
    context.input = { to: 'Paciente X', subject: 'Oi', body: 'Mensagem' };
    const result = await run("sendEmail(db, 'nutri-3', input, now)");
    assert.equal(result.status, 409);
    assert.match(result.speech, /Conectar Google/);
    assert.equal((await run("agenda(db, 'nutri-3', {}, now)")).status, 409);
  });

  console.log(`${count} verificações da Ali da nutricionista passaram. Nenhum serviço externo foi chamado.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
