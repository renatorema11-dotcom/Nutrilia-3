// Firestore e Google simulados para os testes: tudo roda na memória, nenhum serviço externo é chamado.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { stripTypeScriptTypes } = require('node:module');

const DELETE = Symbol('delete');

function createFirestore() {
  const store = new Map();
  const merge = (base, data) => {
    const out = { ...base };
    for (const [key, value] of Object.entries(data)) {
      if (value === DELETE) delete out[key];
      else if (value && value.arrayUnion) out[key] = [...(Array.isArray(out[key]) ? out[key] : []), ...value.arrayUnion];
      else out[key] = value;
    }
    return out;
  };
  const docRef = (col, id) => {
    const key = `${col}/${id}`;
    return {
      id,
      // Subcoleção, como patients/{id}/foodLogs.
      collection: (sub) => collectionOf(`${key}/${sub}`),
      get: async () => ({ exists: store.has(key), id, ref: docRef(col, id), data: () => (store.has(key) ? structuredClone(store.get(key)) : undefined) }),
      set: async (data, options) => { store.set(key, structuredClone(merge(options?.merge ? store.get(key) || {} : {}, data))); },
      delete: async () => { store.delete(key); },
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
  };
  const query = (col, filters) => {
    const test = (data, [field, op, value]) => (op === '==' ? data[field] === value : op === '>=' ? data[field] >= value : data[field] <= value);
    return {
      where: (field, op, value) => query(col, [...filters, [field, op, value]]),
      get: async () => ({
        docs: [...store.entries()]
          .filter(([key, data]) => key.startsWith(`${col}/`) && !key.slice(col.length + 1).includes('/') && filters.every((f) => test(data, f)))
          .map(([key, data]) => ({ id: key.slice(col.length + 1), ref: docRef(col, key.slice(col.length + 1)), data: () => structuredClone(data) })),
      }),
    };
  };
  let added = 0;
  // Declarada como função para o docRef (acima) poder abrir subcoleções.
  function collectionOf(col) {
    return {
      doc: (id) => docRef(col, id),
      where: (field, op, value) => query(col, [[field, op, value]]),
      add: async (data) => { const id = `auto-${++added}`; store.set(`${col}/${id}`, structuredClone(data)); return docRef(col, id); },
    };
  }
  const db = { collection: collectionOf };
  return { store, db, FieldValue: { arrayUnion: (...items) => ({ arrayUnion: items }), delete: () => DELETE } };
}

function parseMail(raw) {
  const [head, ...body] = raw.split('\r\n\r\n');
  const headers = Object.fromEntries(head.split('\r\n').map((line) => [line.slice(0, line.indexOf(':')).toLowerCase(), line.slice(line.indexOf(':') + 2)]));
  const decode = (value) => value.replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b64) => Buffer.from(b64, 'base64').toString('utf8'));
  return { to: headers.to.replace(/[<>]/g, ''), from: decode(headers.from), subject: decode(headers.subject), html: Buffer.from(body.join('').replace(/\r\n/g, ''), 'base64').toString('utf8') };
}

/** Agenda e Gmail de mentira: guardam o que receberam para o teste conferir. */
function createGoogle() {
  const google = { busy: [], events: new Map(), created: 0, deleted: [], sent: [], lastEvent: null, deleteStatus: 204, tokenStatus: 200 };
  google.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    const reply = (status, json) => ({ ok: status >= 200 && status < 300, status, json: async () => { if (json === undefined) throw new Error('sem corpo'); return json; } });
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return google.tokenStatus === 200 ? reply(200, { access_token: 'token-de-teste', expires_in: 3600 }) : reply(google.tokenStatus, { error: 'invalid_grant' });
    }
    if (url.includes('/freeBusy')) return reply(200, { calendars: { primary: { busy: google.busy } } });
    if (url.includes('/gmail/v1/users/me/messages/send')) {
      google.sent.push(parseMail(Buffer.from(body.raw, 'base64url').toString('utf8')));
      return reply(200, { id: `mensagem-${google.sent.length}` });
    }
    const match = url.match(/\/calendars\/primary\/events(?:\/([^?]+))?(?:\?(.*))?$/);
    if (!match) return reply(404, {});
    if (!match[1] && method === 'GET') {
      const params = new URLSearchParams(match[2] || '');
      const from = Date.parse(params.get('timeMin'));
      const to = Date.parse(params.get('timeMax'));
      const items = [...google.events.entries()]
        .map(([id, event]) => ({ id, ...event }))
        .filter((event) => { const at = Date.parse(event.start.dateTime || `${event.start.date}T12:00:00Z`); return at >= from && at < to; })
        .sort((a, b) => Date.parse(a.start.dateTime || a.start.date) - Date.parse(b.start.dateTime || b.start.date));
      return reply(200, { items });
    }
    if (!match[1]) {
      const id = `evento-${++google.created}`;
      google.lastEvent = { id, ...body, query: match[2] || '' };
      google.events.set(id, { status: 'confirmed', summary: body.summary, start: body.start, end: body.end, attendees: body.attendees });
      return reply(200, { id, htmlLink: 'https://calendar.google.com/calendar/event?eid=teste', ...(body.conferenceData ? { hangoutLink: 'https://meet.google.com/abc-defg-hij' } : {}) });
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
  };
  return google;
}

/** Carrega arquivos de lib/ num contexto isolado, sem as importações (as dependências entram como variáveis). */
function loadLib(files, extras) {
  const context = vm.createContext({
    Buffer, URLSearchParams, structuredClone, console: { error: () => {} },
    process: { env: { GOOGLE_CLIENT_ID: 'cliente-de-teste', GOOGLE_CLIENT_SECRET: 'segredo-de-teste', GOOGLE_TOKEN_KEY: 'chave-de-teste-'.repeat(4) } },
    createCipheriv: crypto.createCipheriv, createDecipheriv: crypto.createDecipheriv, createHash: crypto.createHash,
    createHmac: crypto.createHmac, randomBytes: crypto.randomBytes, timingSafeEqual: crypto.timingSafeEqual,
    ...extras,
  });
  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'lib', file), 'utf8');
    const code = stripTypeScriptTypes(source)
      .replace(/^import .*;\r?\n/gm, '')
      .replace(/^export (?=(async )?function|const|let|class)/gm, '');
    vm.runInContext(code, context, { filename: file });
  }
  return context;
}

module.exports = { createFirestore, createGoogle, loadLib };
