import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../../../../firebase-applet-config.json';

export const runtime = 'nodejs';
import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getFirestore, Firestore, FieldValue } from 'firebase-admin/firestore';

/** Ações do próprio paciente: segredo do gateway + ID token Firebase verificado. */
function getAdminApp(): App {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('Admin não configurado');
  const account = JSON.parse(raw);
  if (account.project_id !== firebaseConfig.projectId) throw new Error('Projeto Admin incorreto');
  return getApps().find(a => a.name === 'NutriAliAuthenticated')
    || initializeApp({ credential: cert(account), projectId: firebaseConfig.projectId }, 'NutriAliAuthenticated');
}

function getAdminDb(): Firestore {
  const app = getAdminApp();
  return firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
    ? getFirestore(app, firebaseConfig.firestoreDatabaseId) : getFirestore(app);
}

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided || provided.length > 4096) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Action = 'get_patient_data' | 'log_measurement' | 'log_meal' | 'request_appointment';

const ALLOWED_ACTIONS: Action[] = ['get_patient_data', 'log_measurement', 'log_meal', 'request_appointment'];

interface AgentRequestBody {
  action?: string;
  confirmed?: boolean;
  patientUid?: string;
  payload?: Record<string, unknown>;
}

function numericInput(value: unknown): number {
  if (typeof value === 'number') return value;
  return typeof value === 'string' && /^[0-9]+(?:[.,][0-9]+)?$/.test(value.trim())
    ? Number(value.trim().replace(',', '.')) : NaN;
}

async function audit(db: Firestore, patientUid: string, nutritionistId: string | null, action: Action) {
  try {
    await db.collection('aiActions').add({
      patientUid,
      nutritionistId,
      action,
      result: 'completed', // Não duplicar dados de saúde nem tokens no log de auditoria.
      createdAt: new Date().toISOString(),
    });
  } catch {
    // Auditoria não deve bloquear a ação do paciente, mas o erro precisa aparecer nos logs
    console.error('Ali: falha ao registrar auditoria.');
  }
}

function speechResponse(text: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: true, speech: text, ...extra }, { headers: { 'Cache-Control': 'no-store' } });
}

function speechError(text: string, status = 400) {
  return NextResponse.json({ ok: false, speech: text }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: Request) {
  // Falhar fechado: nunca aceitar chamadas sem segredo no servidor.
  const expectedSecret = process.env.AGENT_API_SECRET;
  if (!expectedSecret || expectedSecret.length < 32) {
    return speechError('A integração ainda não está configurada.', 503);
  }
  if (!secretMatches(req.headers.get('x-webhook-secret'), expectedSecret)) {
    return speechError('Não autorizado.', 401);
  }
  const token = req.headers.get('x-patient-token');
  if (!token || token.length > 8192) return speechError('Entre novamente no aplicativo.', 401);
  let adminApp: App;
  try { adminApp = getAdminApp(); }
  catch { return speechError('A integração ainda não está configurada.', 503); }
  let authenticatedUid: string;
  try {
    // Verifica assinatura, emissor, audiência, validade, revogação e usuário desativado.
    const decoded = await getAuth(adminApp).verifyIdToken(token, true);
    if (decoded.firebase?.sign_in_provider === 'anonymous') {
      return speechError('Entre com sua conta de paciente.', 403);
    }
    authenticatedUid = decoded.uid;
  } catch { return speechError('Sua sessão expirou ou não é válida. Entre novamente.', 401); }

  // 2. Corpo da requisição
  let body: AgentRequestBody;
  try {
    body = await req.json();
  } catch {
    return speechError('Corpo da requisição inválido.', 400);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) return speechError('Corpo inválido.');
  if (body.patientUid !== undefined && body.patientUid !== authenticatedUid) {
    return speechError('Esta sessão não pode acessar outro paciente.', 403);
  }
  if (body.payload !== undefined && (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload))) {
    return speechError('Dados da ação inválidos.');
  }
  const action = body.action as Action;
  const patientUid = authenticatedUid;
  const payload = body.payload || {};

  if (!action || !ALLOWED_ACTIONS.includes(action)) {
    return speechError('Ação não reconhecida. Ações disponíveis: ' + ALLOWED_ACTIONS.join(', ') + '.');
  }
  if (action !== 'get_patient_data' && body.confirmed !== true) {
    return speechError('Confirme os dados antes de registrar a ação.', 422);
  }

  try {
    const db = getAdminDb();
    const patientRef = db.collection('patients').doc(patientUid);
    const patientSnap = await patientRef.get();

    if (!patientSnap.exists) {
      return speechError('Paciente não encontrado na base de dados.', 404);
    }
    const patient = patientSnap.data() as {
      nutritionistId?: string;
      name?: string;
      weight?: number;
      height?: number;
      age?: number;
      objective?: string;
      targetWeight?: number;
      nextAppointment?: string;
      currentPlan?: { status?: string; createdDate?: string; days?: { name: string; meals: { name: string; time: string; items: string[] }[] }[] } | null;
    };

    switch (action) {
      case 'get_patient_data': {
        const approvedPlan = patient.currentPlan?.status === 'approved' ? {
          status: 'approved',
          createdDate: patient.currentPlan.createdDate || '',
          days: (Array.isArray(patient.currentPlan.days) ? patient.currentPlan.days : []).slice(0, 7).map(day => ({
            name: String(day.name || '').slice(0, 100),
            meals: (Array.isArray(day.meals) ? day.meals : []).slice(0, 10).map(meal => ({
              name: String(meal.name || '').slice(0, 100), time: String(meal.time || '').slice(0, 30),
              items: (Array.isArray(meal.items) ? meal.items : []).slice(0, 12).map(item => String(item).slice(0, 500)),
            })),
          })),
        } : null;
        const planSummary = approvedPlan ? approvedPlan.days.map(day => `${day.name}: `
          + day.meals.map(meal => `${meal.name}${meal.time ? ' às ' + meal.time : ''}: ${meal.items.join(', ')}`).join('; ')).join('. ') : '';
        await audit(db, patientUid, (patient.nutritionistId as string) || null, action);
        return speechResponse(
          `Dados de ${patient.name}: objetivo ${patient.objective || 'não informado'}, ` +
          `peso atual ${patient.weight ?? 'não informado'} kg, meta ${patient.targetWeight ?? 'não informada'} kg, ` +
          `próxima consulta ${patient.nextAppointment || 'não agendada'}. ` +
          (approvedPlan ? `Plano aprovado: ${planSummary || 'sem refeições detalhadas'}.` : 'Ainda não há plano aprovado disponível.'),
          { patient: { name: patient.name, weight: patient.weight, objective: patient.objective, targetWeight: patient.targetWeight, nextAppointment: patient.nextAppointment }, approvedPlan }
        );
      }

      case 'log_measurement': {
        const weight = numericInput(payload.weight);
        const bodyFat = payload.bodyFat !== undefined && payload.bodyFat !== null && payload.bodyFat !== '' ? numericInput(payload.bodyFat) : undefined;

        if (!Number.isFinite(weight) || weight <= 20 || weight > 500) {
          return speechError('Peso inválido. Peça ao paciente para informar o peso em quilogramas (ex.: 82.5).');
        }

        if (bodyFat !== undefined && (!Number.isFinite(bodyFat) || bodyFat <= 0 || bodyFat >= 100)) return speechError('Percentual de gordura inválido.', 422);
        const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
        const measurement = {
          date: today,
          weight,
          ...(bodyFat && !Number.isNaN(bodyFat) ? { bodyFat } : {}),
          source: 'ali',
        };

        await patientRef.update({
          weight,
          ...(bodyFat && !Number.isNaN(bodyFat) ? { bodyFat } : {}),
          measurements: FieldValue.arrayUnion(measurement),
        });

        await audit(db, patientUid, (patient.nutritionistId as string) || null, action);
        return speechResponse(`Perfeito! Registrei ${weight} kg${bodyFat ? ` e ${bodyFat}% de gordura` : ''} no seu acompanhamento de hoje. ${patient.targetWeight ? `Faltam ${Math.max(0, Math.round((weight - patient.targetWeight) * 10) / 10)} kg para chegar na sua meta de ${patient.targetWeight} kg. ` : ''}Sua nutricionista vai ver essa evolução no painel dela.`);
      }

      case 'log_meal': {
        if (typeof payload.description !== 'string' || (payload.mealTime !== undefined && typeof payload.mealTime !== 'string')) {
          return speechError('Informe a refeição e o horário em texto.', 422);
        }
        const description = payload.description.trim();
        const mealTime = (payload.mealTime as string | undefined)?.trim() || '';
        if (!description || description.length > 2000 || mealTime.length > 80) {
          return speechError('Falta a descrição da refeição. Pergunte ao paciente o que ele comeu.');
        }

        await patientRef.collection('foodLogs').add({
          description,
          mealTime: mealTime || 'não informado',
          loggedAt: new Date().toISOString(),
          source: 'ali',
        });

        await audit(db, patientUid, (patient.nutritionistId as string) || null, action);
        return speechResponse(`Anotado! Registrei no seu diário alimentar: ${description}${mealTime ? ` (${mealTime})` : ''}. Sua nutricionista acompanha tudo por lá.`);
      }

      case 'request_appointment': {
        if (!patient.nutritionistId) return speechError('Vincule um nutricionista ao seu acompanhamento antes de solicitar uma consulta.', 422);
        if (typeof payload.preferredDate !== 'string' || (payload.notes !== undefined && typeof payload.notes !== 'string')) {
          return speechError('Informe a preferência de data e as observações em texto.', 422);
        }
        const preferredDate = payload.preferredDate.trim();
        const notes = (payload.notes as string | undefined)?.trim() || '';

        if (!preferredDate || preferredDate.length > 100 || notes.length > 1000) return speechError('Informe a data desejada e observações válidas.', 422);
        await db.collection('appointmentRequests').add({
          patientUid,
          nutritionistId: (patient.nutritionistId as string) || null,
          patientName: patient.name || '',
          preferredDate: preferredDate || 'a combinar',
          notes,
          status: 'pending',
          createdAt: new Date().toISOString(),
          source: 'ali',
        });

        await audit(db, patientUid, (patient.nutritionistId as string) || null, action);
        return speechResponse(`Feito! Enviei o pedido de consulta${preferredDate ? ` para ${preferredDate}` : ''} para a sua nutricionista. Ela vai confirmar o horário com você.`);
      }
    }
  } catch {
    console.error('Ali: ação indisponível.');
    return speechError('Não consegui executar essa ação agora. Tenta de novo em instantes.', 500);
  }
}
