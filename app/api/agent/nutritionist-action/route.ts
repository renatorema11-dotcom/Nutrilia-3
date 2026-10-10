import { getAuth } from 'firebase-admin/auth';
import type { App } from 'firebase-admin/app';
import type { Firestore } from 'firebase-admin/firestore';
import { getAdminApp, getAdminDb, hasGatewaySecret, json } from '@/lib/firebase-admin';
import * as assistant from '@/lib/nutritionist-assistant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Ações da Ali da nutricionista: segredo do gateway + ID token Firebase de uma conta de nutricionista. */
type Action = 'list_patients' | 'get_patient' | 'get_agenda' | 'list_contacts'
  | 'schedule_consultation' | 'cancel_consultation' | 'create_event' | 'send_email';

const ALLOWED_ACTIONS: Action[] = ['list_patients', 'get_patient', 'get_agenda', 'list_contacts',
  'schedule_consultation', 'cancel_consultation', 'create_event', 'send_email'];

/** Ações que só leem dados; as demais exigem o "sim" da nutricionista. */
const READ_ONLY_ACTIONS: Action[] = ['list_patients', 'get_patient', 'get_agenda', 'list_contacts'];

function reply(ok: boolean, speech: string, status = 200, extra: Record<string, unknown> = {}) {
  return json({ ok, speech, ...extra }, status);
}

async function audit(db: Firestore, nutritionistId: string, action: Action) {
  try {
    // Só o que foi feito e por quem: o conteúdo de e-mails e compromissos não entra no registro.
    await db.collection('aiActions').add({ nutritionistId, patientUid: null, actor: 'nutritionist', action, result: 'completed', createdAt: new Date().toISOString() });
  } catch {
    console.error('Ali da nutricionista: falha ao registrar auditoria.');
  }
}

export async function POST(req: Request) {
  if (!hasGatewaySecret(req)) return reply(false, 'Não autorizado.', 401);
  const token = req.headers.get('x-nutritionist-token');
  if (!token || token.length > 8192) return reply(false, 'Entre novamente no aplicativo.', 401);
  let adminApp: App;
  try { adminApp = getAdminApp(); }
  catch { return reply(false, 'A integração ainda não está configurada.', 503); }
  let uid: string;
  try {
    const decoded = await getAuth(adminApp).verifyIdToken(token, true);
    if (decoded.firebase?.sign_in_provider === 'anonymous') return reply(false, 'Entre com a sua conta de nutricionista.', 403);
    uid = decoded.uid;
  } catch { return reply(false, 'Sua sessão expirou ou não é válida. Entre novamente.', 401); }

  let body: unknown;
  try { body = await req.json(); } catch { return reply(false, 'Corpo da requisição inválido.', 400); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(false, 'Corpo inválido.', 400);
  const { action, confirmed, payload: rawPayload } = body as Record<string, unknown>;
  if (rawPayload !== undefined && rawPayload !== null && (typeof rawPayload !== 'object' || Array.isArray(rawPayload))) {
    return reply(false, 'Dados da ação inválidos.', 400);
  }
  const payload = (rawPayload || {}) as Record<string, unknown>;
  if (typeof action !== 'string' || !ALLOWED_ACTIONS.includes(action as Action)) return reply(false, 'Ação não reconhecida.', 400);
  const name = action as Action;
  if (!READ_ONLY_ACTIONS.includes(name) && confirmed !== true) {
    return reply(false, 'Confirme com a nutricionista antes de executar esta ação.', 422);
  }

  try {
    const db = getAdminDb();
    // O papel vem do perfil salvo no servidor: paciente nunca usa estas ações.
    const profile = await db.collection('users').doc(uid).get();
    if (!profile.exists || profile.data()?.role !== 'nutritionist') return reply(false, 'Esta assistente é só para nutricionistas.', 403);

    let result: Awaited<ReturnType<typeof assistant.listPatients>>;
    switch (name) {
      case 'list_patients': result = await assistant.listPatients(db, uid, payload.search); break;
      case 'get_patient': result = await assistant.patientSummary(db, uid, payload.patientName); break;
      case 'get_agenda': result = await assistant.agenda(db, uid, { date: payload.date, days: payload.days }); break;
      case 'list_contacts': result = await assistant.listContacts(db, uid); break;
      case 'schedule_consultation': result = await assistant.scheduleConsultation(db, uid, payload); break;
      case 'cancel_consultation': result = await assistant.cancelConsultation(db, uid, payload.patientName); break;
      case 'create_event': result = await assistant.createEvent(db, uid, payload); break;
      case 'send_email': result = await assistant.sendEmail(db, uid, payload); break;
      default: return reply(false, 'Ação não reconhecida.', 400);
    }
    if (!result.ok) return reply(false, result.speech, result.status);
    await audit(db, uid, name);
    const extra = Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'ok' && key !== 'speech'));
    return reply(true, result.speech, 200, extra);
  } catch {
    console.error('Ali da nutricionista: ação indisponível.');
    return reply(false, 'Não consegui fazer isso agora. Tente de novo em instantes.', 500);
  }
}
