// Testa marcar, remarcar, cancelar e lembrar consultas com Firestore, Agenda e Gmail simulados.
// Nenhum serviço externo é chamado: o "Google" aqui é uma função local que guarda o que recebeu.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { stripTypeScriptTypes } = require('node:module');
const assert = require('node:assert/strict');

// ───────────── Firestore simulado ─────────────
const DELETE = Symbol('delete');
const store = new Map();
function merge(base, data) {
  const out = { ...base };
  for (const [key, value] of Object.entries(data)) {
    if (value === DELETE) delete out[key];
    else if (value && value.arrayUnion) out[key] = [...(Array.isArray(out[key]) ? out[key] : []), ...value.arrayUnion];
    else out[key] = value;
  }
  return out;
}
function docRef(col, id) {
  const key = `${col}/${id}`;
  return {
    id,
    get: async () => ({ exists: store.has(key), id, ref: docRef(col, id), data: () => (store.has(key) ? structuredClone(store.get(key)) : undefined) }),
    set: async (data, options) => { store.set(key, structuredClone(merge(options?.merge ? store.get(key) || {} : {}, data))); },
    update: async (data) => {
      if (!store.has(key)) throw new Error('documento não existe');
      const current = structuredClone(store.get(key));
      for (const [field, value] of Object.entries(data)) {
        const parts = field.split('.');
        let target = current;
        for (const part of parts.slice(0, -1)) target = target[part] ??= {};
        target[parts.at(-1)] = structuredClone(value);
      }
      store.set(key, current);
    },
  };
}
function query(col, filters) {
  const test = (data, [field, op, value]) => (op === '==' ? data[field] === value : op === '>=' ? data[field] >= value : data[field] <= value);
  return {
    where: (field, op, value) => query(col, [...filters, [field, op, value]]),
    get: async () => ({
      docs: [...store.entries()]
        .filter(([key, data]) => key.startsWith(`${col}/`) && filters.every((f) => test(data, f)))
        .map(([key, data]) => ({ id: key.slice(col.length + 1), ref: docRef(col, key.slice(col.length + 1)), data: () => structuredClone(data) })),
    }),
  };
}
const db = { collection: (col) => ({ doc: (id) => docRef(col, id), where: (field, op, value) => query(col, [[field, op, value]]) }) };
const FieldValue = { arrayUnion: (...items) => ({ arrayUnion: items }), delete: () => DELETE };

// ───────────── Google simulado ─────────────
const google = { busy: [], events: new Map(), created: 0, deleted: [], sent: [], deleteStatus: 204 };
function parseMail(raw) {
  const [head, ...body] = raw.split('\r\n\r\n');
  const headers = Object.fromEntries(head.split('\r\n').map((line) => [line.slice(0, line.indexOf(':')).toLowerCase(), line.slice(line.indexOf(':') + 2)]));
  const decode = (value) => value.replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b64) => Buffer.from(b64, 'base64').toString('utf8'));
  return { to: headers.to.replace(/[<>]/g, ''), subject: decode(headers.subject), html: Buffer.from(body.join('').replace(/\r\n/g, ''), 'base64').toString('utf8') };
}
async function fakeFetch(url, init = {}) {
  const method = init.method || 'GET';
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
  const reply = (status, json) => ({ ok: status >= 200 && status < 300, status, json: async () => { if (json === undefined) throw new Error('sem corpo'); return json; } });
  if (url.startsWith('https://oauth2.googleapis.com/token')) return reply(200, { access_token: 'token-de-teste', expires_in: 3600 });
  if (url.includes('/freeBusy')) return reply(200, { calendars: { primary: { busy: google.busy } } });
  if (url.includes('/gmail/v1/users/me/messages/send')) {
    google.sent.push(parseMail(Buffer.from(body.raw, 'base64url').toString('utf8')));
    return reply(200, { id: `mensagem-${google.sent.length}` });
  }
  const match = url.match(/\/calendars\/primary\/events(?:\/([^?]+))?/);
  if (!match) return reply(404, {});
  if (!match[1]) {
    const id = `evento-${++google.created}`;
    google.events.set(id, { status: 'confirmed', start: body.start, end: body.end });
    return reply(200, { id, hangoutLink: 'https://meet.google.com/abc-defg-hij', htmlLink: 'https://calendar.google.com/calendar/event?eid=teste' });
  }
  const id = decodeURIComponent(match[1]);
  const event = google.events.get(id);
  if (!event) return reply(404, { error: { code: 404 } });
  if (method === 'GET') return reply(200, { id, ...event });
  if (method === 'PATCH') { Object.assign(event, body); return reply(200, { id, ...event }); }
  if (method === 'DELETE') {
    if (google.deleteStatus !== 204) return reply(google.deleteStatus, { error: {} });
    google.events.delete(id);
    google.deleted.push(id);
    return reply(204);
  }
  return reply(405, {});
}

// ───────────── Código do app carregado sem dependências ─────────────
const context = vm.createContext({
  Buffer, URLSearchParams, structuredClone, FieldValue, fetch: fakeFetch, console: { error: () => {} },
  process: { env: { GOOGLE_CLIENT_ID: 'cliente-de-teste', GOOGLE_CLIENT_SECRET: 'segredo-de-teste', GOOGLE_TOKEN_KEY: 'chave-de-teste-'.repeat(4) } },
  createCipheriv: crypto.createCipheriv, createDecipheriv: crypto.createDecipheriv, createHash: crypto.createHash,
  createHmac: crypto.createHmac, randomBytes: crypto.randomBytes, timingSafeEqual: crypto.timingSafeEqual,
});
for (const file of ['ali-settings.ts', 'agenda.ts', 'google-workspace.ts', 'appointments.ts']) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', file), 'utf8');
  const code = stripTypeScriptTypes(source)
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/^export (?=(async )?function|const|let)/gm, '');
  vm.runInContext(code, context, { filename: file });
}
const run = (code) => vm.runInContext(code, context);
context.db = db;

const NUTRI = 'nutri-1';
const PATIENT = 'paciente-1';
const record = (eventId) => store.get(`aliAppointments/${NUTRI}_${eventId}`);
const listEntry = (uid, eventId) => (store.get(`users/${uid}`)?.appointments || []).find((a) => a.id === eventId);
const minutesBefore = (iso, minutes) => new Date(Date.parse(iso) - minutes * 60_000);

let count = 0;
async function check(name, fn) { await fn(); count++; }

(async () => {
  store.set(`users/${NUTRI}`, { role: 'nutritionist', displayName: 'Nutricionista Teste' });
  store.set(`users/${PATIENT}`, { role: 'patient' });
  store.set(`patients/${PATIENT}`, { name: 'Paciente Teste', nutritionistId: NUTRI });
  store.set(`nutritionistSettings/${NUTRI}`, { ali: { displayName: 'Nutricionista Teste', workDays: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '18:00',
    durationMinutes: 50, intervalMinutes: 10, minNoticeHours: 12, horizonDays: 21, mode: 'online' } });
  store.set(`googleConnections/${NUTRI}`, { status: 'connected', email: 'nutri@exemplo.com', refreshToken: run("encrypt(getGoogleConfig(), 'autorizacao-de-teste')") });

  // Horários reais da grade, um por dia, a partir de três dias à frente (os lembretes começam pendentes).
  const slots = Array.from(await run("loadSettings(db, 'nutri-1').then((s) => generateSlots(s, [], new Date(), { max: 12, perDay: 1 }))"))
    .filter((s) => Date.parse(s.start) - Date.now() > 72 * 3_600_000);
  assert.ok(slots.length >= 4, 'grade com horários suficientes');
  const book = (start, patientEmail = 'paciente@exemplo.com') => {
    context.input = { nutritionistId: NUTRI, patientUid: PATIENT, patientName: 'Paciente Teste', patientEmail, start };
    return run('bookAppointment(db, input)');
  };

  let eventId;
  await check('marcar grava o registro da consulta com lembretes pendentes', async () => {
    const result = await book(slots[0].start);
    assert.equal(result.ok, true);
    [eventId] = [...google.events.keys()];
    const saved = record(eventId);
    assert.equal(saved.status, 'scheduled');
    assert.equal(saved.startLocal, slots[0].start);
    assert.deepEqual(saved.reminders, { day: 'pending', hour: 'pending' });
    assert.equal(saved.meetLink, 'https://meet.google.com/abc-defg-hij');
    assert.equal(listEntry(PATIENT, eventId).status, 'Agendada');
    assert.deepEqual(google.sent.map((m) => m.to), ['paciente@exemplo.com', 'nutri@exemplo.com']);
    assert.match(google.sent[0].html, /pedir para a Ali/);
  });

  await check('remarcar muda a agenda, o registro, as listas e avisa os dois', async () => {
    google.sent.length = 0;
    context.start = slots[1].start;
    const result = await run("rescheduleNextAppointment(db, 'paciente-1', start)");
    assert.equal(result.ok, true);
    assert.equal(result.appointment.start, slots[1].start);
    assert.equal(google.events.get(eventId).start.dateTime, slots[1].start);
    assert.equal(record(eventId).startLocal, slots[1].start);
    assert.deepEqual(record(eventId).reminders, { day: 'pending', hour: 'pending' });
    assert.equal(listEntry(PATIENT, eventId).date, slots[1].start.slice(0, 10));
    assert.equal(listEntry(NUTRI, eventId).time, slots[1].start.slice(11, 16));
    assert.equal(store.get(`patients/${PATIENT}`).nextAppointmentAt, slots[1].start);
    assert.deepEqual(google.sent.map((m) => m.subject.split(':')[0]), ['Consulta remarcada', 'Consulta remarcada pelo paciente']);
  });

  await check('remarcar para o mesmo horário ou para um horário ocupado não muda nada', async () => {
    context.start = slots[1].start;
    const same = await run("rescheduleNextAppointment(db, 'paciente-1', start)");
    assert.equal(same.status, 409);
    google.busy = [{ start: new Date(slots[2].start).toISOString(), end: new Date(Date.parse(slots[2].start) + 30 * 60_000).toISOString() }];
    context.start = slots[2].start;
    const busy = await run("rescheduleNextAppointment(db, 'paciente-1', start)");
    assert.equal(busy.status, 409);
    assert.match(busy.speech, /ocupado/);
    assert.equal(record(eventId).startLocal, slots[1].start);
    context.start = 'amanhã cedo';
    assert.equal((await run("rescheduleNextAppointment(db, 'paciente-1', start)")).status, 422);
    google.busy = [];
  });

  await check('lembretes saem uma vez na véspera e uma vez perto da consulta', async () => {
    google.sent.length = 0;
    const startAt = record(eventId).startAt;
    const tick = (minutes) => { context.now = minutesBefore(startAt, minutes); return run('runAppointmentReminders(db, now)'); };
    assert.equal((await tick(24 * 60 + 20)).sent, 0);
    assert.equal((await tick(24 * 60 - 5)).sent, 1);
    assert.equal((await tick(24 * 60 - 15)).sent, 0);
    assert.equal((await tick(60)).sent, 1);
    assert.equal((await tick(50)).sent, 0);
    assert.deepEqual(record(eventId).reminders, { day: 'sent', hour: 'sent' });
    assert.deepEqual(google.sent.map((m) => m.to), ['paciente@exemplo.com', 'paciente@exemplo.com']);
    assert.match(google.sent[0].subject, /^Lembrete da sua consulta/);
    assert.match(google.sent[1].html, /meet\.google\.com/);
  });

  await check('consulta mudada direto na agenda é acompanhada, sem lembrete no horário velho', async () => {
    google.sent.length = 0;
    await docRef('aliAppointments', `${NUTRI}_${eventId}`).update({ 'reminders.day': 'pending' });
    const before = record(eventId).startAt;
    const moved = new Date(Date.parse(slots[3].start));
    google.events.get(eventId).start = { dateTime: slots[3].start };
    google.events.get(eventId).end = { dateTime: new Date(moved.getTime() + 50 * 60_000).toISOString() };
    context.now = minutesBefore(before, 23 * 60);
    const stats = await run('runAppointmentReminders(db, now)');
    assert.equal(stats.moved, 1);
    assert.equal(stats.sent, 0);
    assert.equal(record(eventId).startLocal, slots[3].start);
    assert.equal(listEntry(PATIENT, eventId).date, slots[3].start.slice(0, 10));
    assert.equal(google.sent.length, 0);
  });

  await check('consulta apagada direto na agenda vira cancelada no app', async () => {
    google.events.delete(eventId);
    context.now = minutesBefore(record(eventId).startAt, 23 * 60);
    const stats = await run('runAppointmentReminders(db, now)');
    assert.equal(stats.cancelled, 1);
    assert.equal(record(eventId).status, 'cancelled');
    assert.equal(listEntry(NUTRI, eventId).status, 'Cancelada');
    assert.equal(store.get(`patients/${PATIENT}`).nextAppointment, '');
    assert.ok(!('nextAppointmentAt' in store.get(`patients/${PATIENT}`)));
  });

  await check('cancelar por voz libera a agenda e avisa a nutricionista', async () => {
    google.sent.length = 0;
    assert.equal((await book(slots[0].start)).ok, true);
    const id = [...google.events.keys()].at(-1);
    google.sent.length = 0;
    const result = await run("cancelNextAppointment(db, 'paciente-1')");
    assert.equal(result.ok, true);
    assert.match(result.speech, /avisei Nutricionista Teste/);
    assert.ok(!google.events.has(id));
    assert.equal(record(id).status, 'cancelled');
    assert.equal(listEntry(PATIENT, id).status, 'Cancelada');
    assert.deepEqual(google.sent.map((m) => [m.to, m.subject.split(':')[0]]), [['nutri@exemplo.com', 'Consulta cancelada pelo paciente']]);
    assert.equal((await run("cancelNextAppointment(db, 'paciente-1')")).status, 409);
  });

  await check('agenda fora do ar: a consulta continua marcada', async () => {
    assert.equal((await book(slots[1].start)).ok, true);
    const id = [...google.events.keys()].at(-1);
    google.deleteStatus = 500;
    const result = await run("cancelNextAppointment(db, 'paciente-1')");
    assert.equal(result.status, 502);
    assert.equal(record(id).status, 'scheduled');
    assert.ok(google.events.has(id));
    google.deleteStatus = 204;
  });

  await check('botão do app: só o paciente ou a nutricionista da consulta cancelam', async () => {
    const id = [...google.events.keys()].at(-1);
    context.id = id;
    assert.equal((await run("cancelAppointmentById(db, { uid: 'paciente-2', role: 'patient' }, id)")).status, 404);
    assert.equal((await run("cancelAppointmentById(db, { uid: 'nutri-2', role: 'nutritionist' }, id)")).status, 404);
    assert.equal(record(id).status, 'scheduled');
    google.sent.length = 0;
    const result = await run("cancelAppointmentById(db, { uid: 'nutri-1', role: 'nutritionist' }, id)");
    assert.equal(result.ok, true);
    assert.equal(record(id).status, 'cancelled');
    assert.deepEqual(google.sent.map((m) => [m.to, m.subject.split(':')[0]]), [['paciente@exemplo.com', 'Consulta cancelada']]);
    assert.match((await run("cancelAppointmentById(db, { uid: 'nutri-1', role: 'nutritionist' }, id)")).speech, /já estava cancelada/);
  });

  await check('paciente sem e-mail: lembrete é dispensado, sem erro', async () => {
    google.sent.length = 0;
    assert.equal((await book(slots[2].start, null)).ok, true);
    const id = [...google.events.keys()].at(-1);
    google.sent.length = 0;
    context.now = minutesBefore(record(id).startAt, 23 * 60);
    const stats = await run('runAppointmentReminders(db, now)');
    assert.deepEqual([stats.sent, stats.failed], [0, 0]);
    assert.equal(record(id).reminders.day, 'skipped');
    assert.equal(google.sent.length, 0);
  });

  console.log(`${count} verificações de consultas (marcar, remarcar, cancelar e lembrar) passaram. Nenhum serviço externo foi chamado.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
