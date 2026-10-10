// Integração de cada nutricionista com o próprio Google (Agenda e Gmail). Somente no servidor.
// A autorização fica criptografada em googleConnections/{uid}; o navegador nunca a vê.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { defaultAliSettings, sanitizeAliSettings, describeMode, type AliSettings } from './ali-settings';
import { generateSlots, isFree, searchWindow, slotLabel, toOffsetIso, validateSlotStart, type Interval, type Period, type Slot } from './agenda';

export const GOOGLE_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/gmail.send',
];
const REQUIRED_SCOPES = GOOGLE_SCOPES.filter((s) => s.startsWith('https://'));

export interface GoogleConfig { clientId: string; clientSecret: string; tokenKey: string; redirectUri: string }

export function getGoogleConfig(): GoogleConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const tokenKey = process.env.GOOGLE_TOKEN_KEY || '';
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'https://app.nutriali.cloud/api/google/callback';
  if (!clientId || !clientSecret || tokenKey.length < 32) return null;
  return { clientId, clientSecret, tokenKey, redirectUri };
}

// ───────────── Criptografia e assinatura ─────────────

function derivedKey(cfg: GoogleConfig, purpose: string): Buffer {
  return createHash('sha256').update(`nutriali:${purpose}:${cfg.tokenKey}`).digest();
}

function encrypt(cfg: GoogleConfig, text: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derivedKey(cfg, 'token'), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

function decrypt(cfg: GoogleConfig, value: string): string {
  const [version, iv, tag, data] = value.split('.');
  if (version !== 'v1') throw new Error('formato desconhecido');
  const decipher = createDecipheriv('aes-256-gcm', derivedKey(cfg, 'token'), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

const b64url = (buf: Buffer) => buf.toString('base64url');

/** Estado do OAuth: diz quem iniciou a conexão e expira em 10 minutos. */
export function signState(cfg: GoogleConfig, uid: string, nonce: string): string {
  const body = b64url(Buffer.from(JSON.stringify({ uid, nonce, exp: Date.now() + 10 * 60_000 })));
  const sig = b64url(createHmac('sha256', derivedKey(cfg, 'state')).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyState(cfg: GoogleConfig, state: string): { uid: string; nonce: string } | null {
  const [body, sig] = (state || '').split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', derivedKey(cfg, 'state')).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof data.uid !== 'string' || typeof data.nonce !== 'string' || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return { uid: data.uid, nonce: data.nonce };
  } catch {
    return null;
  }
}

export function newNonce(): string {
  return b64url(randomBytes(18));
}

// ───────────── OAuth com o Google ─────────────

export function buildAuthUrl(cfg: GoogleConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json: json as Record<string, unknown> };
}

/** Troca o código pela autorização e grava a conexão da nutricionista. */
export async function completeConnection(db: Firestore, cfg: GoogleConfig, uid: string, code: string):
  Promise<{ ok: true; email: string } | { ok: false; reason: 'exchange' | 'scopes' | 'no_refresh' }> {
  const { ok, json } = await tokenRequest({
    code, client_id: cfg.clientId, client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri, grant_type: 'authorization_code',
  });
  if (!ok) return { ok: false, reason: 'exchange' };
  const scopes = String(json.scope || '').split(' ');
  if (!REQUIRED_SCOPES.every((s) => scopes.includes(s))) {
    if (typeof json.access_token === 'string') await revokeToken(json.access_token);
    return { ok: false, reason: 'scopes' };
  }
  if (typeof json.refresh_token !== 'string') return { ok: false, reason: 'no_refresh' };
  // O id_token veio direto do Google por HTTPS: basta ler o e-mail da conta conectada.
  let email = '';
  try {
    const payload = JSON.parse(Buffer.from(String(json.id_token).split('.')[1], 'base64url').toString('utf8'));
    email = typeof payload.email === 'string' ? payload.email : '';
  } catch { /* sem e-mail */ }
  await db.collection('googleConnections').doc(uid).set({
    email,
    scopes: REQUIRED_SCOPES,
    refreshToken: encrypt(cfg, json.refresh_token),
    status: 'connected',
    connectedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  accessCache.delete(uid);
  return { ok: true, email };
}

export async function revokeToken(token: string) {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => undefined);
}

export async function disconnect(db: Firestore, cfg: GoogleConfig | null, uid: string) {
  const ref = db.collection('googleConnections').doc(uid);
  const snap = await ref.get();
  if (snap.exists && cfg) {
    try { await revokeToken(decrypt(cfg, String(snap.data()?.refreshToken || ''))); } catch { /* já inválido */ }
  }
  await ref.delete();
  accessCache.delete(uid);
}

export interface ConnectionStatus { configured: boolean; connected: boolean; email: string; needsReconnect: boolean }

export async function connectionStatus(db: Firestore, uid: string): Promise<ConnectionStatus> {
  const configured = !!getGoogleConfig();
  const snap = await db.collection('googleConnections').doc(uid).get();
  const data = snap.exists ? snap.data() || {} : {};
  return {
    configured,
    connected: snap.exists && data.status === 'connected',
    email: typeof data.email === 'string' ? data.email : '',
    needsReconnect: snap.exists && data.status === 'needs_reconnect',
  };
}

const accessCache = new Map<string, { token: string; email: string; expiresAt: number }>();

type Access = { ok: true; token: string; email: string } | { ok: false; reason: 'not_configured' | 'not_connected' | 'needs_reconnect' | 'unavailable' };

/** Token de acesso da nutricionista, renovado com a autorização guardada. */
export async function getAccess(db: Firestore, uid: string): Promise<Access> {
  const cfg = getGoogleConfig();
  if (!cfg) return { ok: false, reason: 'not_configured' };
  const cached = accessCache.get(uid);
  if (cached && cached.expiresAt > Date.now() + 60_000) return { ok: true, token: cached.token, email: cached.email };
  const ref = db.collection('googleConnections').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, reason: 'not_connected' };
  const data = snap.data() || {};
  if (data.status !== 'connected') return { ok: false, reason: 'needs_reconnect' };
  let refreshToken: string;
  try { refreshToken = decrypt(cfg, String(data.refreshToken || '')); }
  catch { return { ok: false, reason: 'needs_reconnect' }; }
  const { ok, json } = await tokenRequest({
    client_id: cfg.clientId, client_secret: cfg.clientSecret,
    refresh_token: refreshToken, grant_type: 'refresh_token',
  });
  if (!ok || typeof json.access_token !== 'string') {
    if (json.error === 'invalid_grant') {
      await ref.update({ status: 'needs_reconnect', updatedAt: new Date().toISOString() });
      return { ok: false, reason: 'needs_reconnect' };
    }
    return { ok: false, reason: 'unavailable' };
  }
  const email = typeof data.email === 'string' ? data.email : '';
  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 3000;
  accessCache.set(uid, { token: json.access_token, email, expiresAt: Date.now() + expiresIn * 1000 });
  return { ok: true, token: json.access_token, email };
}

// ───────────── Agenda e Gmail ─────────────

async function googleApi(token: string, url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google respondeu ${res.status}`);
  return json as Record<string, any>;
}

async function busyIntervals(token: string, window: Interval, timeZone: string): Promise<Interval[]> {
  const json = await googleApi(token, 'https://www.googleapis.com/calendar/v3/freeBusy', {
    timeMin: window.start.toISOString(), timeMax: window.end.toISOString(), timeZone, items: [{ id: 'primary' }],
  });
  const busy = json.calendars?.primary?.busy;
  if (!Array.isArray(busy)) throw new Error('agenda sem resposta');
  return busy.map((b: { start: string; end: string }) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

const EMAIL_RE = /^[^\s@<>"',;:()\[\]\\]+@[^\s@<>"',;:()\[\]\\]+\.[^\s@<>"',;:()\[\]\\]+$/;

export function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value);
}

function encodeHeader(text: string): string {
  return `=?UTF-8?B?${Buffer.from(text.replace(/[\r\n]+/g, ' '), 'utf8').toString('base64')}?=`;
}

async function sendMail(token: string, mail: { fromName: string; fromEmail: string; to: string; subject: string; html: string }) {
  if (!isValidEmail(mail.to) || !isValidEmail(mail.fromEmail)) throw new Error('e-mail inválido');
  const message = [
    `From: ${encodeHeader(mail.fromName || 'NutriAli')} <${mail.fromEmail}>`,
    `To: <${mail.to}>`,
    `Subject: ${encodeHeader(mail.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(mail.html, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n'),
  ].join('\r\n');
  await googleApi(token, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    raw: Buffer.from(message, 'utf8').toString('base64url'),
  });
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function emailLayout(title: string, body: string, footer: string): string {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f2f7f4;font-family:Arial,Helvetica,sans-serif;color:#14251f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f7f4;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #dbe7e0">
<tr><td style="background:#4c8466;color:#ffffff;padding:18px 24px;font-size:18px;font-weight:bold">NutriAli</td></tr>
<tr><td style="padding:24px"><h1 style="margin:0 0 16px;font-size:20px;color:#276e58">${escapeHtml(title)}</h1>${body}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #dbe7e0;color:#5b6f67;font-size:12px">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

const p = (html: string) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6">${html}</p>`;

// ───────────── Configurações da Ali ─────────────

export async function loadSettings(db: Firestore, nutritionistId: string): Promise<AliSettings> {
  const [settingsSnap, userSnap] = await Promise.all([
    db.collection('nutritionistSettings').doc(nutritionistId).get(),
    db.collection('users').doc(nutritionistId).get(),
  ]);
  const fallbackName = String(userSnap.exists ? userSnap.data()?.displayName || '' : '').slice(0, 80);
  const stored = settingsSnap.exists ? settingsSnap.data()?.ali : undefined;
  const settings = sanitizeAliSettings(stored, defaultAliSettings(fallbackName));
  if (!settings.displayName) settings.displayName = fallbackName;
  return settings;
}

export async function saveSettings(db: Firestore, nutritionistId: string, input: unknown): Promise<AliSettings> {
  const current = await loadSettings(db, nutritionistId);
  const settings = sanitizeAliSettings(input, current);
  await db.collection('nutritionistSettings').doc(nutritionistId).set({ ali: settings, updatedAt: new Date().toISOString() }, { merge: true });
  return settings;
}

// ───────────── Ações da Ali ─────────────

type ActionResult = { ok: true; speech: string; [key: string]: unknown } | { ok: false; status: number; speech: string };

function accessFailure(reason: Exclude<Access, { ok: true }>['reason'], fallback: string): ActionResult {
  if (reason === 'unavailable') return { ok: false, status: 502, speech: 'Não consegui acessar a agenda da sua nutricionista agora. Tente de novo em instantes.' };
  return { ok: false, status: 409, speech: fallback };
}

const NOT_CONNECTED_AGENDA = 'A agenda da sua nutricionista ainda não está conectada à Ali. Posso registrar um pedido de consulta para ela confirmar com você.';

export async function findFreeSlots(db: Firestore, nutritionistId: string, filters: { date?: unknown; period?: unknown }): Promise<ActionResult> {
  const access = await getAccess(db, nutritionistId);
  if (!access.ok) return accessFailure(access.reason, NOT_CONNECTED_AGENDA);
  const settings = await loadSettings(db, nutritionistId);
  const now = new Date();
  const date = typeof filters.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(filters.date) ? filters.date : undefined;
  const period = filters.period === 'manha' || filters.period === 'tarde' || filters.period === 'noite' ? filters.period as Period : undefined;
  let busy: Interval[];
  try { busy = await busyIntervals(access.token, searchWindow(settings, now), settings.timezone); }
  catch { return { ok: false, status: 502, speech: 'Não consegui ver a agenda agora. Tente de novo em instantes.' }; }
  const slots: Slot[] = generateSlots(settings, busy, now, { date, period, max: 5 });
  if (!slots.length) {
    return { ok: true, speech: date || period
      ? 'Não encontrei horário livre com esse filtro. Quer que eu veja outros dias ou períodos?'
      : 'Não encontrei horários livres nas próximas semanas. Posso registrar um pedido de consulta para a nutricionista combinar com você.', slots: [] };
  }
  const who = settings.displayName ? ` com ${settings.displayName}` : '';
  return {
    ok: true,
    speech: `Tenho estes horários livres${who}: ${slots.map((s) => s.label).join('; ')}. Qual prefere?`,
    slots: slots.map((s) => ({ start: s.start, label: s.label })),
    mode: settings.mode,
  };
}

export interface BookingInput {
  nutritionistId: string;
  patientUid: string;
  patientName: string;
  patientEmail: string | null;
  start: unknown;
  mode: unknown;
  notes: unknown;
}

export async function bookAppointment(db: Firestore, input: BookingInput): Promise<ActionResult> {
  const access = await getAccess(db, input.nutritionistId);
  if (!access.ok) return accessFailure(access.reason, NOT_CONNECTED_AGENDA);
  const settings = await loadSettings(db, input.nutritionistId);
  const now = new Date();
  const checked = validateSlotStart(settings, String(input.start || ''), now);
  if ('error' in checked) return { ok: false, status: 422, speech: `${checked.error} Peça para eu buscar os horários livres de novo.` };
  const { start, end } = checked;
  const tz = settings.timezone;

  let busy: Interval[];
  try { busy = await busyIntervals(access.token, { start: new Date(start.getTime() - 3_600_000), end: new Date(end.getTime() + 3_600_000) }, tz); }
  catch { return { ok: false, status: 502, speech: 'Não consegui ver a agenda agora. Tente de novo em instantes.' }; }
  if (!isFree(start, end, busy, settings.intervalMinutes)) {
    return { ok: false, status: 409, speech: 'Esse horário acabou de ser ocupado. Quer que eu veja outros horários livres?' };
  }

  const mode = settings.mode === 'ambos' ? (input.mode === 'presencial' ? 'presencial' : 'online') : settings.mode;
  const notes = typeof input.notes === 'string' ? input.notes.trim().slice(0, 500) : '';
  const event: Record<string, unknown> = {
    summary: `Consulta nutricional — ${input.patientName || 'Paciente'}`,
    description: `Consulta marcada pela Ali (NutriAli).${notes ? `\nObservações do paciente: ${notes}` : ''}`,
    start: { dateTime: toOffsetIso(start, tz), timeZone: tz },
    end: { dateTime: toOffsetIso(end, tz), timeZone: tz },
    reminders: { useDefault: true },
    extendedProperties: { private: { nutrialiPatientUid: input.patientUid, source: 'ali' } },
    ...(input.patientEmail ? { attendees: [{ email: input.patientEmail, displayName: input.patientName || undefined }] } : {}),
    ...(mode === 'presencial'
      ? { location: settings.address || undefined }
      : { conferenceData: { createRequest: { requestId: newNonce(), conferenceSolutionKey: { type: 'hangoutsMeet' } } } }),
  };

  let created: Record<string, any>;
  try {
    created = await googleApi(access.token,
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=${input.patientEmail ? 'all' : 'none'}`, event);
  } catch {
    return { ok: false, status: 502, speech: 'Não consegui marcar na agenda agora. Nenhuma consulta foi criada. Tente de novo em instantes.' };
  }

  const meetLink: string = created.hangoutLink
    || (Array.isArray(created.conferenceData?.entryPoints) ? created.conferenceData.entryPoints.find((e: { entryPointType?: string }) => e.entryPointType === 'video')?.uri : '')
    || '';
  const label = slotLabel(start, tz);
  const [datePart, timePart] = toOffsetIso(start, tz).split('T');
  const appointment = {
    id: String(created.id || newNonce()),
    patientName: input.patientName || 'Paciente',
    date: datePart,
    time: timePart.slice(0, 5),
    type: 'Retorno',
    status: 'Agendada',
    source: 'ali',
    mode,
    ...(meetLink ? { meetLink } : {}),
  };

  // Registro no app (a consulta já existe na agenda; falhas aqui não desfazem o evento).
  try {
    await Promise.all([
      db.collection('patients').doc(input.patientUid).set({ nextAppointment: label, nextAppointmentAt: toOffsetIso(start, tz) }, { merge: true }),
      db.collection('users').doc(input.patientUid).set({ appointments: FieldValue.arrayUnion(appointment) }, { merge: true }),
      db.collection('users').doc(input.nutritionistId).set({ appointments: FieldValue.arrayUnion(appointment) }, { merge: true }),
    ]);
  } catch {
    console.error('Ali: consulta criada na agenda, mas não registrada no app.');
  }

  const where = mode === 'presencial'
    ? (settings.address ? `Endereço: ${escapeHtml(settings.address)}` : 'Consulta presencial.')
    : (meetLink ? `Link da chamada: <a href="${escapeHtml(meetLink)}" style="color:#276e58">${escapeHtml(meetLink)}</a>` : 'Consulta online.');
  const nutriName = settings.displayName || 'sua nutricionista';

  // E-mails: confirmação para o paciente e aviso para a nutricionista (falha não desfaz a consulta).
  let patientMailed = false;
  if (input.patientEmail) {
    try {
      await sendMail(access.token, {
        fromName: settings.displayName || 'NutriAli', fromEmail: access.email, to: input.patientEmail,
        subject: `Consulta confirmada: ${label}`,
        html: emailLayout('Sua consulta está confirmada', [
          p(`Olá, ${escapeHtml(input.patientName || '')}!`),
          p(`Sua consulta com ${escapeHtml(nutriName)} está marcada para <strong>${escapeHtml(label)}</strong>, com duração de ${settings.durationMinutes} minutos.`),
          p(where),
          settings.contact ? p(`Se precisar remarcar, fale com ${escapeHtml(nutriName)}: ${escapeHtml(settings.contact)}.`) : '',
          p('Você também recebeu o convite na sua agenda do Google.'),
        ].join(''), 'Consulta marcada pela Ali, a assistente do NutriAli.'),
      });
      patientMailed = true;
    } catch {
      console.error('Ali: falha ao enviar confirmação ao paciente.');
    }
  }
  try {
    await sendMail(access.token, {
      fromName: 'Ali — NutriAli', fromEmail: access.email, to: access.email,
      subject: `Ali marcou uma consulta: ${input.patientName || 'Paciente'} — ${label}`,
      html: emailLayout('Nova consulta marcada pela Ali', [
        p(`<strong>Paciente:</strong> ${escapeHtml(input.patientName || 'Paciente')}${input.patientEmail ? ` (${escapeHtml(input.patientEmail)})` : ''}`),
        p(`<strong>Quando:</strong> ${escapeHtml(label)} (${settings.durationMinutes} minutos), ${escapeHtml(describeMode(mode as AliSettings['mode']))}.`),
        p(where),
        notes ? p(`<strong>Observações do paciente:</strong> ${escapeHtml(notes)}`) : '',
        created.htmlLink ? p(`<a href="${escapeHtml(created.htmlLink)}" style="color:#276e58">Abrir na Agenda do Google</a>`) : '',
      ].join(''), 'Aviso automático do NutriAli.'),
    });
  } catch {
    console.error('Ali: falha ao avisar a nutricionista.');
  }

  return {
    ok: true,
    speech: `Pronto! Sua consulta com ${nutriName} ficou marcada para ${label}. `
      + (mode === 'presencial' ? (settings.address ? `É presencial, em ${settings.address}. ` : 'É presencial. ') : 'É online, pelo Google Meet. ')
      + (patientMailed ? 'Mandei a confirmação para o seu e-mail.' : 'O convite chega pela agenda do Google.'),
    appointment: { label, start: toOffsetIso(start, tz), mode },
  };
}

interface PlanDay { name: string; meals: { name: string; time: string; items: string[] }[] }

export async function sendPlanEmail(db: Firestore, input: { nutritionistId: string; patientUid: string; patientName: string; patientEmail: string | null; days: PlanDay[] }): Promise<ActionResult> {
  if (!input.patientEmail) return { ok: false, status: 422, speech: 'Não encontrei um e-mail válido no seu cadastro. Peça para a sua nutricionista atualizar.' };
  if (!input.days.length) return { ok: false, status: 409, speech: 'Você ainda não tem um plano aprovado pela sua nutricionista para eu enviar.' };
  const access = await getAccess(db, input.nutritionistId);
  if (!access.ok) return accessFailure(access.reason, 'O envio por e-mail ainda não está ativado pela sua nutricionista. Você pode ver o plano completo no aplicativo, em Meu Plano.');

  // No máximo um envio a cada 10 minutos para o mesmo paciente.
  const patientRef = db.collection('patients').doc(input.patientUid);
  const snap = await patientRef.get();
  const last = snap.exists ? Date.parse(String(snap.data()?.planEmailSentAt || '')) : NaN;
  if (Number.isFinite(last) && Date.now() - last < 10 * 60_000) {
    return { ok: true, speech: 'Acabei de enviar o plano para o seu e-mail. Dê uma olhada na caixa de entrada e no spam.' };
  }

  const settings = await loadSettings(db, input.nutritionistId);
  const nutriName = settings.displayName || 'sua nutricionista';
  const daysHtml = input.days.map((day) => `<h2 style="margin:20px 0 8px;font-size:16px;color:#276e58">${escapeHtml(day.name)}</h2>`
    + day.meals.map((meal) => p(`<strong>${escapeHtml(meal.name)}${meal.time ? ` — ${escapeHtml(meal.time)}` : ''}</strong><br>${meal.items.map(escapeHtml).join('<br>')}`)).join('')).join('');
  try {
    await sendMail(access.token, {
      fromName: settings.displayName || 'NutriAli', fromEmail: access.email, to: input.patientEmail,
      subject: 'Seu plano alimentar',
      html: emailLayout('Seu plano alimentar', p(`Olá, ${escapeHtml(input.patientName || '')}! Este é o plano aprovado por ${escapeHtml(nutriName)}.`) + daysHtml,
        'Enviado pela Ali, a assistente do NutriAli. Em caso de dúvida, fale com a sua nutricionista.'),
    });
  } catch {
    return { ok: false, status: 502, speech: 'Não consegui enviar o e-mail agora. Tente de novo em instantes.' };
  }
  await patientRef.set({ planEmailSentAt: new Date().toISOString() }, { merge: true });
  return { ok: true, speech: `Enviei o seu plano alimentar para ${input.patientEmail}. Se não aparecer, confira a caixa de spam.` };
}

/** Avisa a nutricionista sobre um pedido de consulta (melhor esforço: nunca falha a ação da Ali). */
export async function notifyAppointmentRequest(db: Firestore, input: { nutritionistId: string; patientName: string; preferredDate: string; notes: string }): Promise<void> {
  try {
    const access = await getAccess(db, input.nutritionistId);
    if (!access.ok) return;
    await sendMail(access.token, {
      fromName: 'Ali — NutriAli', fromEmail: access.email, to: access.email,
      subject: `Novo pedido de consulta pela Ali: ${input.patientName || 'Paciente'}`,
      html: emailLayout('Novo pedido de consulta', [
        p(`<strong>Paciente:</strong> ${escapeHtml(input.patientName || 'Paciente')}`),
        p(`<strong>Preferência:</strong> ${escapeHtml(input.preferredDate)}`),
        input.notes ? p(`<strong>Observações:</strong> ${escapeHtml(input.notes)}`) : '',
        p('Confirme o horário com o paciente pelo chat do NutriAli.'),
      ].join(''), 'Aviso automático do NutriAli.'),
    });
  } catch {
    console.error('Ali: falha ao avisar pedido de consulta.');
  }
}
