import { getAdminDb, json, verifyCaller } from '@/lib/firebase-admin';
import { connectionStatus, loadSettings, saveSettings } from '@/lib/google-workspace';
import { loadContacts, saveContacts } from '@/lib/nutritionist-assistant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Configurações da Ali da nutricionista logada, contatos salvos e situação da conexão com o Google. */
export async function GET(req: Request) {
  const caller = await verifyCaller(req);
  if (!caller || caller.role !== 'nutritionist') return json({ error: 'Acesso permitido só para nutricionistas.' }, 403);
  try {
    const db = getAdminDb();
    const [settings, google, contacts] = await Promise.all([loadSettings(db, caller.uid), connectionStatus(db, caller.uid), loadContacts(db, caller.uid)]);
    return json({ settings, google, contacts });
  } catch {
    return json({ error: 'Não foi possível carregar as configurações agora.' }, 503);
  }
}

export async function PUT(req: Request) {
  const caller = await verifyCaller(req);
  if (!caller || caller.role !== 'nutritionist') return json({ error: 'Acesso permitido só para nutricionistas.' }, 403);
  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: 'Dados inválidos.' }, 400); }
  const data = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  const input = data?.settings;
  // Os contatos são opcionais no pedido: sem a lista, ficam como estão.
  const contactsInput = data?.contacts;
  if (!input || typeof input !== 'object' || (contactsInput !== undefined && !Array.isArray(contactsInput))) return json({ error: 'Dados inválidos.' }, 400);
  try {
    const db = getAdminDb();
    const settings = await saveSettings(db, caller.uid, input);
    const contacts = contactsInput === undefined ? await loadContacts(db, caller.uid) : await saveContacts(db, caller.uid, contactsInput);
    return json({ settings, contacts });
  } catch {
    return json({ error: 'Não foi possível salvar agora.' }, 503);
  }
}
