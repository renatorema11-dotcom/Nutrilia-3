import { getAdminDb, json, verifyCaller } from '@/lib/firebase-admin';
import { connectionStatus, loadSettings, saveSettings } from '@/lib/google-workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Configurações da Ali da nutricionista logada e situação da conexão com o Google. */
export async function GET(req: Request) {
  const caller = await verifyCaller(req);
  if (!caller || caller.role !== 'nutritionist') return json({ error: 'Acesso permitido só para nutricionistas.' }, 403);
  try {
    const db = getAdminDb();
    const [settings, google] = await Promise.all([loadSettings(db, caller.uid), connectionStatus(db, caller.uid)]);
    return json({ settings, google });
  } catch {
    return json({ error: 'Não foi possível carregar as configurações agora.' }, 503);
  }
}

export async function PUT(req: Request) {
  const caller = await verifyCaller(req);
  if (!caller || caller.role !== 'nutritionist') return json({ error: 'Acesso permitido só para nutricionistas.' }, 403);
  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: 'Dados inválidos.' }, 400); }
  const input = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).settings : undefined;
  if (!input || typeof input !== 'object') return json({ error: 'Dados inválidos.' }, 400);
  try {
    const settings = await saveSettings(getAdminDb(), caller.uid, input);
    return json({ settings });
  } catch {
    return json({ error: 'Não foi possível salvar agora.' }, 503);
  }
}
