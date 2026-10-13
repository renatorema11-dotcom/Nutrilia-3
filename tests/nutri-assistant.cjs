// Testa a Ali da nutricionista (pacientes, agenda, consultas, compromissos, e-mails e contatos)
// com Firestore, Agenda e Gmail simulados. Nenhum serviço externo é chamado.
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createFirestore, createGoogle, loadLib } = require('./fakes.cjs');

const { store, db, FieldValue } = createFirestore();
const google = createGoogle();
const context = loadLib(['ali-settings.ts', 'agenda.ts', 'google-workspace.ts', 'appointments.ts', 'weekly-report.ts', 'nutritionist-assistant.ts'], { FieldValue, fetch: google.fetch });
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

  // ───────────── Fase 1 das funções novas ─────────────

  await check('remarcar consulta: muda na agenda, mantém a duração e avisa o paciente', async () => {
    // João tem a consulta de sexta, 16, às 10:30 (marcada mais acima) e não tem e-mail.
    const joao = Object.entries(Object.fromEntries(store)).find(([key, value]) => key.startsWith('aliAppointments/') && value.patientUid === 'p-joao')[0];
    google.sent.length = 0;
    const moved = await call('rescheduleConsultation', { patientName: 'João Pereira', date: '2026-10-19', time: '9h' }, ', now');
    assert.equal(moved.ok, true);
    assert.match(moved.speech, /Remarquei a consulta de João Pereira para segunda-feira, 19 de outubro, às 09:00\. O paciente não tem e-mail cadastrado/);
    const record = store.get(joao);
    assert.equal(record.startLocal, '2026-10-19T09:00:00-03:00');
    assert.equal(Date.parse(record.endAt) - Date.parse(record.startAt), 50 * 60_000);
    assert.deepEqual(record.reminders, { day: 'pending', hour: 'pending' });
    assert.equal(google.events.get(record.eventId).start.dateTime, '2026-10-19T09:00:00-03:00');
    assert.match(store.get('patients/p-joao').nextAppointment, /19 de outubro/);
    assert.equal(google.sent.length, 0);
    // O mesmo horário de novo, horário que já passou e paciente sem consulta marcada não mudam nada.
    assert.equal((await call('rescheduleConsultation', { patientName: 'João Pereira', date: '2026-10-19', time: '09:00' }, ', now')).status, 409);
    assert.equal((await call('rescheduleConsultation', { patientName: 'João Pereira', date: '2026-10-13', time: '08:00' }, ', now')).status, 422);
    const none = await call('rescheduleConsultation', { patientName: 'Ana Souza', date: '2026-10-20', time: '10:00' }, ', now');
    assert.equal(none.status, 409);
    assert.match(none.speech, /Não encontrei consulta/);
    assert.equal((await call('rescheduleConsultation', { patientName: 'Marcos', date: '2026-10-20', time: '10:00' }, ', now')).status, 404);
  });

  await check('remarcar: horário ocupado pede confirmação, mas o horário antigo da própria consulta não conta', async () => {
    assert.equal((await call('scheduleConsultation', { patientName: 'Ana Souza', date: '2026-10-21', time: '11:00' }, ', now')).ok, true);
    google.sent.length = 0;
    // A agenda mostra ocupado o horário da própria consulta (11:00 às 11:50) e um compromisso às 16:00.
    google.busy = [{ start: '2026-10-21T14:00:00Z', end: '2026-10-21T14:50:00Z' }, { start: '2026-10-22T19:00:00Z', end: '2026-10-22T20:00:00Z' }];
    const warned = await call('rescheduleConsultation', { patientName: 'Ana Souza', date: '2026-10-22', time: '16:30' }, ', now');
    assert.equal(warned.status, 409);
    assert.match(warned.speech, /remarcar mesmo assim/);
    assert.match(store.get('patients/p-ana').nextAppointment, /21 de outubro/);
    const shifted = await call('rescheduleConsultation', { patientName: 'Ana Souza', date: '2026-10-21', time: '11:30' }, ', now');
    assert.equal(shifted.ok, true);
    const forced = await call('rescheduleConsultation', { patientName: 'Ana Souza', date: '2026-10-22', time: '16:30', force: true }, ', now');
    assert.equal(forced.ok, true);
    assert.match(forced.speech, /quinta-feira, 22 de outubro, às 16:30\. O paciente foi avisado por e-mail\./);
    const mails = google.sent.filter((m) => m.to === 'ana@exemplo.com' && /^Consulta remarcada/.test(m.subject));
    assert.equal(mails.length, 2);
    assert.match(mails[1].html, /remarcou a sua consulta para <strong>quinta-feira, 22 de outubro, às 16:30/);
    assert.match(store.get('patients/p-ana').nextAppointment, /22 de outubro/);
    google.busy = [];
  });

  await check('registrar medição: grava no prontuário com a data de hoje e não empilha correções do mesmo dia', async () => {
    store.set('patients/p-joao', { ...store.get('patients/p-joao'), height: 175, measurements: [{ date: '2026-10-01', weight: 90, height: 175 }] });
    const first = await call('logMeasurement', { patientName: 'Ana Souza', weight: '71,8', bodyFat: 27 }, ', now');
    assert.equal(first.ok, true);
    assert.equal(first.speech, 'Anotei 71,8 quilos e 27 por cento de gordura no prontuário de Ana Souza, com a data de hoje. A diferença para a meta de 65 quilos é de 6,8 quilos.');
    let ana = store.get('patients/p-ana');
    assert.equal(ana.weight, 71.8);
    assert.equal(ana.bodyFat, 27);
    assert.deepEqual(ana.measurements, [{ date: '2026-10-13', weight: 71.8, bodyFat: 27, source: 'nutritionist' }]);
    assert.equal(ana.currentPlan.status, 'approved'); // o resto do prontuário continua igual
    assert.equal((await call('logMeasurement', { patientName: 'Ana Souza', weight: 71.5 }, ', now')).ok, true);
    ana = store.get('patients/p-ana');
    assert.deepEqual(ana.measurements, [{ date: '2026-10-13', weight: 71.5, source: 'nutritionist' }]);
    assert.equal(ana.bodyFat, 27);
    // Medição de outro dia fica; a de hoje entra depois, com a altura do prontuário.
    const joao = await call('logMeasurement', { patientName: 'João Pereira', weight: 89 }, ', now');
    assert.equal(joao.speech, 'Anotei 89 quilos no prontuário de João Pereira, com a data de hoje.');
    assert.deepEqual(store.get('patients/p-joao').measurements, [{ date: '2026-10-01', weight: 90, height: 175 }, { date: '2026-10-13', weight: 89, height: 175, source: 'nutritionist' }]);
    for (const bad of [{ weight: 'abc' }, { weight: 5 }, { weight: 900 }, {}, { weight: 70, bodyFat: 150 }, { weight: 70, bodyFat: 'muito' }]) {
      assert.equal((await call('logMeasurement', { patientName: 'João Pereira', ...bad }, ', now')).status, 422);
    }
    assert.equal(store.get('patients/p-joao').weight, 89);
    assert.equal((await call('logMeasurement', { patientName: 'Ana', weight: 70 }, ', now')).status, 409);
    assert.equal((await call('logMeasurement', { patientName: 'Marcos', weight: 70 }, ', now')).status, 404);
  });

  await check('recado no chat: cai na conversa direta do paciente, no formato que a tela e as regras esperam', async () => {
    const sent = await call('sendChatMessage', { patientName: 'Ana Souza', text: '  Pode trocar o iogurte por uma fruta.  ' }, ', now');
    assert.equal(sent.ok, true);
    assert.equal(sent.speech, 'Recado enviado para Ana Souza no chat do aplicativo.');
    assert.ok(store.get('chats/p-ana_nutri-1').updatedAt instanceof Date);
    const messages = [...store.entries()].filter(([key]) => key.startsWith('chats/p-ana_nutri-1/messages/')).map(([, value]) => value);
    assert.deepEqual(messages, [{ senderId: 'nutri-1', senderName: 'Dra. Carla Mendes', senderRole: 'nutritionist', text: 'Pode trocar o iogurte por uma fruta.', createdAt: '2026-10-13T13:00:00.000Z' }]);
    assert.equal((await call('sendChatMessage', { patientName: 'Ana Souza', text: ' ' }, ', now')).status, 422);
    assert.equal((await call('sendChatMessage', { patientName: 'Ana Souza', text: 'x'.repeat(1001) }, ', now')).status, 422);
    assert.equal((await call('sendChatMessage', { patientName: 'Marcos', text: 'Oi' }, ', now')).status, 404);
    assert.equal([...store.keys()].filter((key) => key.startsWith('chats/')).length, 2); // a conversa e uma mensagem só
  });

  await check('plano por e-mail: só plano aprovado, com refeições, para paciente dela com e-mail', async () => {
    store.set('patients/p-bia', { name: 'Bia Costa', email: 'bia@exemplo.com', nutritionistId: NUTRI });
    context.name = 'Ana Souza';
    const empty = await run("sendPlanToPatient(db, 'nutri-1', name)");
    assert.equal(empty.status, 409);
    assert.match(empty.speech, /sem refeições/);
    store.set('patients/p-ana', { ...store.get('patients/p-ana'), currentPlan: { status: 'approved', days: [
      { name: 'Segunda a sexta', meals: [{ time: '12:30', name: 'Almoço', items: ['Arroz integral', 'Feijão <carioca>'] }] }, { name: 'Vazio', meals: [] },
    ] } });
    google.sent.length = 0;
    const sent = await run("sendPlanToPatient(db, 'nutri-1', name)");
    assert.equal(sent.ok, true);
    assert.equal(sent.speech, 'O plano alimentar de Ana Souza foi enviado para o e-mail cadastrado.');
    assert.deepEqual(google.sent.map((m) => [m.to, m.subject]), [['ana@exemplo.com', 'Seu plano alimentar']]);
    assert.match(google.sent[0].html, /Segunda a sexta/);
    assert.match(google.sent[0].html, /Feijão &lt;carioca&gt;/);
    assert.doesNotMatch(google.sent[0].html, /Vazio/);
    const refuse = async (name) => { context.name = name; return run("sendPlanToPatient(db, 'nutri-1', name)"); };
    assert.match((await refuse('João Pereira')).speech, /não tem e-mail cadastrado/);
    assert.match((await refuse('Ana Paula Lima')).speech, /ainda está em rascunho/);
    assert.match((await refuse('Bia Costa')).speech, /ainda não tem plano alimentar/);
    assert.equal((await refuse('Marcos')).status, 404);
    assert.equal(google.sent.length, 1);
  });

  await check('resumo da semana por voz: os mesmos números do resumo por e-mail, em poucas frases', async () => {
    store.set('patients/p-ana/foodLogs/l1', { description: 'Almoço', loggedAt: '2026-10-12T15:00:00.000Z' });
    context.lastSeen = async () => new Map([['p-ana', new Date('2026-10-12T12:00:00Z')], ['p-joao', new Date('2026-10-01T12:00:00Z')], ['p-ana2', null]]);
    const week = await run("weekSummary(db, 'nutri-1', lastSeen, now)");
    assert.equal(week.ok, true);
    assert.match(week.speech, /^Você tem 4 pacientes\. Nos próximos sete dias há 1 consulta marcada; a primeira é segunda-feira, 19, às 09:00, com João Pereira\./);
    assert.match(week.speech, /Nos últimos sete dias, registraram refeição ou peso: Ana Souza e João Pereira\./);
    assert.match(week.speech, /Sem abrir o aplicativo há uma semana ou mais: Ana Paula Lima e João Pereira\./);
    assert.match(week.speech, /Planos esperando a sua aprovação: Ana Paula Lima\. Ainda sem plano: Bia Costa e João Pereira\.$/);
    assert.deepEqual(JSON.parse(JSON.stringify(week.summary)), { patients: 4, appointments: 1, active: ['Ana Souza', 'João Pereira'], away: ['Ana Paula Lima', 'João Pereira'], drafts: ['Ana Paula Lima'], noPlan: ['Bia Costa', 'João Pereira'] });
    // Sem a informação de acesso, o resumo sai sem a frase de sumidos em vez de acusar todo mundo.
    context.lastSeen = async () => { throw new Error('login fora do ar'); };
    const blind = await run("weekSummary(db, 'nutri-1', lastSeen, now)");
    assert.doesNotMatch(blind.speech, /Sem abrir|Todos abriram/);
    assert.equal(blind.summary.away, null);
    store.set('users/nutri-vazia', { role: 'nutritionist', displayName: 'Nova' });
    assert.match((await run("weekSummary(db, 'nutri-vazia', lastSeen, now)")).speech, /ainda não tem pacientes/);
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
