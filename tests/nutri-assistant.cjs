// Testa a Ali da nutricionista (pacientes, agenda, consultas, compromissos, e-mails e contatos)
// com Firestore, Agenda e Gmail simulados. Nenhum serviço externo é chamado.
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createFirestore, createGoogle, loadLib } = require('./fakes.cjs');

const { store, db, FieldValue } = createFirestore();
const google = createGoogle();
const context = loadLib(['ali-settings.ts', 'agenda.ts', 'google-workspace.ts', 'appointments.ts', 'weekly-report.ts', 'daily-log.ts', 'consultation-notes.ts', 'taco-foods.ts', 'food-table.ts', 'plan-nutrition.ts', 'nutritionist-assistant.ts'], { FieldValue, fetch: google.fetch });
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

  // ───────────── Fase 2 ─────────────

  await check('pedidos de consulta: só os pendentes dela, do mais antigo ao mais novo', async () => {
    store.set('appointmentRequests/r1', { patientUid: 'p-bia', nutritionistId: NUTRI, patientName: 'Bia Costa', preferredDate: 'sexta de manhã', notes: 'Prefiro online', status: 'pending', createdAt: '2026-10-11T12:00:00.000Z' });
    store.set('appointmentRequests/r2', { patientUid: 'p-ana2', nutritionistId: NUTRI, patientName: 'Ana Paula Lima', preferredDate: 'a combinar', notes: '', status: 'pending', createdAt: '2026-10-13T11:00:00.000Z' });
    store.set('appointmentRequests/r3', { patientUid: 'p-ana', nutritionistId: NUTRI, patientName: 'Ana Souza', preferredDate: 'semana passada', status: 'confirmed', createdAt: '2026-10-01T12:00:00.000Z' });
    store.set('appointmentRequests/r4', { patientUid: 'p-outro', nutritionistId: 'nutri-2', patientName: 'Marcos', preferredDate: 'segunda', status: 'pending', createdAt: '2026-10-10T12:00:00.000Z' });
    const list = await run("listAppointmentRequests(db, 'nutri-1', now)");
    assert.equal(list.speech, 'Você tem 2 pedidos de consulta esperando resposta: Bia Costa, com preferência por sexta de manhã, pedido há 2 dias; observação: Prefiro online. Ana Paula Lima, sem data de preferência, pedido hoje.');
    assert.deepEqual(Array.from(list.requests, (r) => r.patientName), ['Bia Costa', 'Ana Paula Lima']);
    assert.equal((await run("listAppointmentRequests(db, 'nutri-vazia', now)")).speech, 'Não há pedidos de consulta esperando resposta.');
  });

  await check('marcar a consulta de quem pediu atende o pedido; o paciente vê a consulta marcada', async () => {
    const booked = await call('scheduleConsultation', { patientName: 'Bia Costa', date: '2026-10-16', time: '15:00' }, ', now');
    assert.equal(booked.ok, true);
    assert.match(booked.speech, /Marquei a consulta de Bia Costa .* O pedido de consulta que estava aberto foi marcado como atendido\.$/);
    const r1 = store.get('appointmentRequests/r1');
    assert.deepEqual([r1.status, r1.appointmentLabel, r1.answeredAt], ['confirmed', 'sexta-feira, 16 de outubro, às 15:00', NOW.toISOString()]);
    assert.equal(store.get('appointmentRequests/r2').status, 'pending'); // o pedido de outra paciente continua aberto
    assert.equal(store.get('appointmentRequests/r4').status, 'pending');
  });

  await check('encerrar pedido sem marcar: com texto, o recado vai para o chat; sem texto, só o aviso no app', async () => {
    const declined = await call('declineAppointmentRequest', { patientName: 'Ana Paula Lima', text: ' Esta semana não tenho horário. Vamos ver na próxima? ' }, ', now');
    assert.equal(declined.speech, 'Pedido de consulta de Ana Paula Lima encerrado. O recado foi enviado no chat do aplicativo.');
    assert.equal(store.get('appointmentRequests/r2').status, 'declined');
    const chat = [...store.entries()].filter(([key]) => key.startsWith('chats/p-ana2_nutri-1/messages/')).map(([, value]) => [value.senderRole, value.text]);
    assert.deepEqual(chat, [['nutritionist', 'Esta semana não tenho horário. Vamos ver na próxima?']]);
    const none = await call('declineAppointmentRequest', { patientName: 'Ana Paula Lima' }, ', now');
    assert.equal(none.status, 409);
    assert.match(none.speech, /não tem pedido de consulta esperando resposta/);

    store.set('appointmentRequests/r5', { patientUid: 'p-joao', nutritionistId: NUTRI, patientName: 'João Pereira', preferredDate: 'qualquer dia', status: 'pending', createdAt: '2026-10-12T12:00:00.000Z' });
    const quiet = await call('declineAppointmentRequest', { patientName: 'João Pereira' }, ', now');
    assert.equal(quiet.speech, 'Pedido de consulta de João Pereira encerrado. No aplicativo, o paciente vê que o pedido não pôde ser atendido.');
    assert.equal([...store.keys()].filter((key) => key.startsWith('chats/p-joao_')).length, 0);

    // Recado longo demais e paciente de outra nutricionista não mudam nenhum pedido.
    store.set('appointmentRequests/r6', { patientUid: 'p-joao', nutritionistId: NUTRI, patientName: 'João Pereira', preferredDate: 'qualquer dia', status: 'pending', createdAt: '2026-10-13T09:00:00.000Z' });
    assert.equal((await call('declineAppointmentRequest', { patientName: 'João Pereira', text: 'x'.repeat(1001) }, ', now')).status, 422);
    assert.equal(store.get('appointmentRequests/r6').status, 'pending');
    assert.equal((await call('declineAppointmentRequest', { patientName: 'Marcos' }, ', now')).status, 404);
    assert.equal(store.get('appointmentRequests/r4').status, 'pending');
    assert.match((await run("listAppointmentRequests(db, 'nutri-1', now)")).speech, /^Você tem 1 pedido de consulta esperando resposta: João Pereira, com preferência por qualquer dia, pedido hoje\.$/);
  });

  await check('anotações da consulta: fora do prontuário que o paciente lê, e só da nutricionista certa', async () => {
    const saved = await call('addConsultationNote', { patientName: 'Ana Souza', text: '  Relatou mais fome à noite.\r\n\r\n\r\nCombinamos trocar o lanche da tarde.  ' }, ', now');
    assert.equal(saved.speech, 'Anotação salva no prontuário de Ana Souza. Só você vê as anotações das consultas.');
    const stored = [...store.entries()].filter(([key]) => key.startsWith('consultationNotes/')).map(([, value]) => value);
    assert.deepEqual(stored, [{ nutritionistId: NUTRI, patientUid: 'p-ana', text: 'Relatou mais fome à noite.\n\nCombinamos trocar o lanche da tarde.', source: 'ali', createdAt: NOW.toISOString() }]);
    assert.ok(!JSON.stringify(store.get('patients/p-ana')).includes('fome'));
    assert.equal((await call('addConsultationNote', { patientName: 'Ana Souza', text: 'ok' }, ', now')).status, 422);
    assert.equal((await call('addConsultationNote', { patientName: 'Ana Souza', text: 'x'.repeat(2001) }, ', now')).status, 422);
    assert.equal((await call('addConsultationNote', { patientName: 'Marcos', text: 'Anotação qualquer' }, ', now')).status, 404);

    store.set('consultationNotes/antiga', { nutritionistId: NUTRI, patientUid: 'p-ana', text: 'Primeira consulta: objetivo emagrecer.', source: 'app', createdAt: '2026-09-29T15:00:00.000Z' });
    store.set('consultationNotes/alheia', { nutritionistId: 'nutri-2', patientUid: 'p-ana', text: 'Nota de outra pessoa', source: 'app', createdAt: '2026-10-12T15:00:00.000Z' });
    context.name = 'Ana Souza';
    const notes = await run("consultationNotes(db, 'nutri-1', name)");
    assert.equal(notes.speech, 'Últimas 2 anotações de Ana Souza. Em 13 de outubro: Relatou mais fome à noite. Combinamos trocar o lanche da tarde. Em 29 de setembro: Primeira consulta: objetivo emagrecer.');
    // Apagar: só a dona da anotação.
    assert.equal(await run("removeNote(db, 'nutri-2', 'antiga')"), false);
    assert.equal(await run("removeNote(db, 'nutri-1', 'alheia')"), false);
    assert.equal(await run("removeNote(db, 'nutri-1', '../antiga')"), false);
    assert.equal(await run("removeNote(db, 'nutri-1', 'antiga')"), true);
    assert.equal(store.has('consultationNotes/antiga'), false);
    assert.equal(store.has('consultationNotes/alheia'), true);
    context.name = 'João Pereira';
    assert.equal((await run("consultationNotes(db, 'nutri-1', name)")).speech, 'Você ainda não tem anotações de consulta de João Pereira.');
  });

  await check('resumo antes da consulta: peso, registros, água e humor, acesso, plano, pedido e última anotação', async () => {
    store.set('patients/p-ana', { ...store.get('patients/p-ana'), measurements: [{ date: '2026-09-29', weight: 73 }, ...store.get('patients/p-ana').measurements] });
    store.set('patients/p-ana/foodLogs/l2', { description: 'Jantar: sopa de legumes', loggedAt: '2026-10-10T22:00:00.000Z' });
    store.set('patients/p-ana/foodLogs/l3', { description: 'Antiga', loggedAt: '2026-09-20T12:00:00.000Z' });
    store.set('users/p-ana', { role: 'patient', waterIntake: { amount: 1250, date: '2026-10-13' }, moodDiary: { mood: 'happy', date: '2026-10-13' } });
    context.lastSeen = async () => new Map([['p-ana', new Date('2026-10-12T12:00:00Z')], ['p-joao', new Date('2026-10-01T12:00:00Z')], ['p-ana2', null]]);
    context.name = 'Ana Souza';
    const ana = await run("consultationBrief(db, 'nutri-1', name, lastSeen, now)");
    assert.equal(ana.speech, 'Resumo de Ana Souza, com consulta marcada para quinta-feira, 22 de outubro, às 16:30. Objetivo: Emagrecimento. '
      + 'Peso atual 71,5 quilos, de 13 de outubro; desceu 1,5 quilos desde 29 de setembro; faltam 6,5 quilos para a meta de 65 quilos. '
      + 'Nos últimos 14 dias, 2 refeições anotadas pela Ali, em 2 dias; a mais recente: Almoço. Hoje: 1250 ml de água e humor feliz. '
      + 'Abriu o aplicativo ontem. Plano alimentar aprovado. Última anotação de consulta, de 13 de outubro: Relatou mais fome à noite. Combinamos trocar o lanche da tarde.');

    // Sem nome: a próxima consulta marcada (a de Bia, sexta às 15:00).
    context.name = '';
    const next = await run("consultationBrief(db, 'nutri-1', name, lastSeen, now)");
    assert.equal(next.speech, 'Resumo de Bia Costa, com consulta marcada para sexta-feira, 16 de outubro, às 15:00. Nos últimos 14 dias, nenhuma refeição anotada pela Ali. Ainda sem plano alimentar. Ainda não há anotações de consulta.');
    const nothing = await run("consultationBrief(db, 'nutri-vazia', name, lastSeen, now)");
    assert.equal(nothing.status, 404);

    // Consulta marcada à mão no app também conta; pedido aberto e dias sem abrir o app entram no resumo.
    store.set(`users/${NUTRI}`, { ...store.get(`users/${NUTRI}`), appointments: [...store.get(`users/${NUTRI}`).appointments,
      { id: 'man_1', patientName: 'João Pereira', date: '2026-10-14', time: '08:00', status: 'Agendada', source: 'manual', patientUid: 'p-joao' }] });
    context.name = 'joão';
    const joao = await run("consultationBrief(db, 'nutri-1', name, lastSeen, now)");
    assert.equal(joao.speech, 'Resumo de João Pereira, com consulta marcada para quarta-feira, 14 de outubro, às 08:00. Objetivo: Saúde. '
      + 'Peso atual 89 quilos, de 13 de outubro; desceu 1 quilo desde 1 de outubro. Nos últimos 14 dias, nenhuma refeição anotada pela Ali. '
      + 'Está há 12 dias sem abrir o aplicativo. Ainda sem plano alimentar. Tem um pedido de consulta aberto, com preferência por qualquer dia. Ainda não há anotações de consulta.');
    // Sem a informação de acesso, a frase do último acesso fica de fora.
    context.failing = async () => { throw new Error('login fora do ar'); };
    assert.doesNotMatch((await run("consultationBrief(db, 'nutri-1', name, failing, now)")).speech, /aplicativo\./);
    context.name = 'Marcos';
    assert.equal((await run("consultationBrief(db, 'nutri-1', name, lastSeen, now)")).status, 404);
  });

  await check('quem precisa de atenção: motivos por paciente, do mais urgente ao menos urgente', async () => {
    store.set('patients/p-ana2', { ...store.get('patients/p-ana2'), targetWeight: 60, measurements: [{ date: '2026-10-01', weight: 62 }, { date: '2026-10-12', weight: 63.4 }] });
    store.set('users/p-bia', { role: 'patient', moodDiary: { mood: 'sad', date: '2026-10-13' } });
    const list = await run("attentionList(db, 'nutri-1', lastSeen, now)");
    assert.equal(list.speech, '3 pacientes precisam de atenção. '
      + 'Ana Paula Lima: o peso subiu 1,4 quilos na última medição, se afastando da meta, ainda não entrou no aplicativo e o plano está esperando a sua aprovação. '
      + 'João Pereira: pediu consulta, com preferência por qualquer dia, está há 12 dias sem abrir o aplicativo e ainda não tem plano alimentar. '
      + 'Bia Costa: marcou hoje que não está bem e ainda não tem plano alimentar.');
    assert.deepEqual(Array.from(list.attention, (row) => row.name), ['Ana Paula Lima', 'João Pereira', 'Bia Costa']);
    assert.ok(!list.speech.includes('Ana Souza'));
    // Sem a informação de acesso, ninguém é acusado de sumido.
    const blind = await run("attentionList(db, 'nutri-1', failing, now)");
    assert.doesNotMatch(blind.speech, /aplicativo/);
    assert.deepEqual(Array.from(blind.attention, (row) => row.name), ['Ana Paula Lima', 'Bia Costa', 'João Pereira']);
    store.set('users/nutri-4', { role: 'nutritionist', displayName: 'Tudo em dia' });
    store.set('patients/p-ok', { name: 'Paciente Em Dia', nutritionistId: 'nutri-4', currentPlan: { status: 'approved' } });
    assert.equal((await run("attentionList(db, 'nutri-4', lastSeen, now)")).speech, 'Ninguém precisa de atenção especial agora.');
    assert.match((await run("attentionList(db, 'nutri-vazia', lastSeen, now)")).speech, /ainda não tem pacientes/);
  });

  // ───────────── Fase 3 ─────────────

  const tasks = [];
  context.later = (task) => { tasks.push(task); };
  const aiCalls = [];
  const samplePlan = { days: [
    { name: 'Segunda a sexta', meals: [{ time: '07:30', name: 'Café da manhã', items: ['Pão integral', 'Ovo mexido', 'Café'] }, { time: '12:30', name: 'Almoço', items: ['Arroz', 'Feijão', 'Frango'] }] },
    { name: 'Fim de semana', meals: [{ time: '09:00', name: 'Café', items: ['Tapioca'] }] },
  ] };
  context.generate = async (ctx, instructions) => { aiCalls.push([ctx, instructions]); return samplePlan; };

  await check('rascunho de plano por voz: responde na hora, monta depois e não manda o nome do paciente para a IA', async () => {
    context.input = { patientName: 'Bia Costa', text: ' Sem lactose, 1800 kcal, 5 refeições ' };
    const started = await run("createPlanDraft(db, 'nutri-1', input, generate, later, now)");
    assert.equal(started.speech, 'Comecei a montar o rascunho do plano de Bia Costa, com as suas orientações. Leva cerca de um minuto. Depois é só me pedir para ler o rascunho, ou abrir o prontuário no aplicativo para revisar e aprovar.');
    assert.equal(store.get('patients/p-bia').planDraftJob.status, 'running');
    assert.deepEqual([aiCalls.length, tasks.length], [0, 1]); // a IA só trabalha depois da resposta
    assert.equal((await run("createPlanDraft(db, 'nutri-1', input, generate, later, now)")).status, 409); // já está montando
    context.name = 'Bia Costa';
    assert.match((await run("planDraft(db, 'nutri-1', name, now)")).speech, /^Ainda estou montando o rascunho de Bia Costa/);

    await tasks.shift()();
    assert.deepEqual(aiCalls[0], [JSON.stringify({ idade: null, objetivo: null, pesoAtual: null, altura: null, pesoMeta: null }), 'Sem lactose, 1800 kcal, 5 refeições']);
    const bia = store.get('patients/p-bia');
    assert.deepEqual([bia.currentPlan.status, bia.currentPlan.source, bia.currentPlan.instructions, bia.currentPlan.days.length, bia.planDraftJob.status],
      ['draft', 'ali', 'Sem lactose, 1800 kcal, 5 refeições', 2, 'done']);
    assert.equal(bia.pendingPlan, undefined);
    const read = await run("planDraft(db, 'nutri-1', name, now)");
    assert.equal(read.speech, 'Rascunho do plano de Bia Costa, feito pela Ali, esperando a sua aprovação. Segunda a sexta: Café da manhã às 07:30, Pão integral, Ovo mexido e Café; Almoço às 12:30, Arroz, Feijão e Frango. Também tem Fim de semana. Para aprovar ou mudar, abra o prontuário no aplicativo.');
    assert.equal(read.plan.days.length, 2);

    // Já existe rascunho: a Ali pergunta antes de fazer outro; com a confirmação, refaz no lugar.
    const asks = await run("createPlanDraft(db, 'nutri-1', input, generate, later, now)");
    assert.equal(asks.status, 409);
    assert.match(asks.speech, /já tem um rascunho de plano esperando a sua aprovação\. Quer que eu faça um novo no lugar dele\?$/);
    context.input = { patientName: 'Bia Costa', force: true };
    assert.equal((await run("createPlanDraft(db, 'nutri-1', input, generate, later, now)")).speech.includes('com as suas orientações'), false);
    await tasks.shift()();
    assert.equal(store.get('patients/p-bia').currentPlan.instructions, undefined);
  });

  await check('rascunho para quem já tem plano aprovado: fica ao lado, e o plano atual continua valendo', async () => {
    const before = store.get('patients/p-ana').currentPlan;
    context.input = { patientName: 'Ana Souza', text: 'Mais proteína no café' };
    const started = await run("createPlanDraft(db, 'nutri-1', input, generate, later, now)");
    assert.match(started.speech, / O plano atual continua valendo até você aprovar o novo\.$/);
    await tasks.shift()();
    assert.deepEqual(JSON.parse(aiCalls[aiCalls.length - 1][0]), { idade: null, objetivo: 'Emagrecimento', pesoAtual: 71.5, altura: null, pesoMeta: 65 });
    const ana = store.get('patients/p-ana');
    assert.deepEqual(ana.currentPlan, before);
    assert.deepEqual([ana.pendingPlan.status, ana.pendingPlan.source], ['draft', 'ali']);
    context.name = 'Ana Souza';
    const read = await run("planDraft(db, 'nutri-1', name, now)");
    assert.match(read.speech, /^Rascunho do plano de Ana Souza, feito pela Ali, esperando a sua aprovação\./);
    assert.equal(read.plan.replacesApproved, true);
    assert.match((await run("patientSummary(db, 'nutri-1', name)")).speech, /plano aprovado, com um rascunho novo esperando a sua aprovação/);
    assert.ok((await run("attentionList(db, 'nutri-1', lastSeen, now)")).attention.find((row) => row.name === 'Ana Souza').reasons.includes('o plano está esperando a sua aprovação'));
  });

  await check('rascunho com os alimentos ligados à TACO: a Ali diz o total estimado do dia', async () => {
    const ana = store.get('patients/p-ana');
    store.set('patients/p-ana', { ...ana, pendingPlan: { ...ana.pendingPlan, days: [{ name: 'Segunda a sexta', meals: [
      { time: '12:30', name: 'Almoço', items: ['Arroz integral', 'Feijão carioca', 'Item fora da tabela'], foods: [{ taco: 1, grams: 150 }, { taco: 561, grams: 100 }, null] },
    ] }] } });
    context.name = 'Ana Souza';
    const read = await run("planDraft(db, 'nutri-1', name, now)");
    // Arroz integral cozido 150 g (186 kcal; 3,9 g de proteína) + feijão carioca cozido 100 g (76 kcal; 4,8 g).
    assert.match(read.speech, /Pela tabela TACO, Segunda a sexta soma cerca de 262 calorias e 9 gramas de proteína./);
    assert.deepEqual(JSON.parse(JSON.stringify(read.plan.days[0].meals[0].foods)), [{ taco: 1, grams: 150 }, { taco: 561, grams: 100 }, null]);
    store.set('patients/p-ana', ana);
  });

  await check('rascunho que falhou ou ficou parado: a Ali conta e oferece tentar de novo; pedido mais novo vence', async () => {
    context.failAi = async () => { const error = new Error('A inteligência artificial está indisponível no momento. Tente de novo em alguns minutos.'); error.status = 503; throw error; };
    context.input = { patientName: 'João Pereira' };
    await run("createPlanDraft(db, 'nutri-1', input, failAi, later, now)");
    await tasks.shift()();
    assert.equal(store.get('patients/p-joao').planDraftJob.status, 'failed');
    assert.equal(store.get('patients/p-joao').currentPlan, undefined);
    context.name = 'João Pereira';
    assert.equal((await run("planDraft(db, 'nutri-1', name, now)")).speech,
      'Não consegui montar o último rascunho de João Pereira. A inteligência artificial está indisponível no momento. Tente de novo em alguns minutos. Quer que eu tente de novo?');
    // Erro sem mensagem própria: sem detalhes.
    context.crash = async () => { throw new Error('detalhe interno'); };
    await run("createPlanDraft(db, 'nutri-1', input, crash, later, now)");
    await tasks.shift()();
    assert.equal((await run("planDraft(db, 'nutri-1', name, now)")).speech, 'Não consegui montar o último rascunho de João Pereira. Quer que eu tente de novo?');

    // Pedido parado há mais de 3 minutos conta como falha e não impede um novo.
    store.set('patients/p-joao', { ...store.get('patients/p-joao'), planDraftJob: { id: 'velho', status: 'running', startedAt: '2026-10-13T12:50:00.000Z' } });
    assert.match((await run("planDraft(db, 'nutri-1', name, now)")).speech, /^Não consegui montar o último rascunho/);
    await run("createPlanDraft(db, 'nutri-1', input, generate, later, now)");
    // Um pedido mais novo começou antes deste terminar: o resultado antigo não é gravado.
    store.set('patients/p-joao', { ...store.get('patients/p-joao'), planDraftJob: { id: 'mais-novo', status: 'running', startedAt: NOW.toISOString() } });
    await tasks.shift()();
    assert.equal(store.get('patients/p-joao').currentPlan, undefined);

    context.input = { patientName: 'João Pereira', text: 'x'.repeat(1001) };
    assert.equal((await run("createPlanDraft(db, 'nutri-1', input, generate, later, now)")).status, 422);
    context.input = { patientName: 'Marcos' };
    assert.equal((await run("createPlanDraft(db, 'nutri-1', input, generate, later, now)")).status, 404);
    context.name = 'Paciente Inexistente';
    assert.equal((await run("planDraft(db, 'nutri-1', name, now)")).status, 404);
    assert.equal(tasks.length, 0);
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
