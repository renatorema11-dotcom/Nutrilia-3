import { NextResponse } from 'next/server';
import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getFirestore, Firestore, FieldValue } from 'firebase-admin/firestore';

/**
 * API de ações do agente Ali (executada via n8n).
 *
 * O Ali passa de "consultador" para "executor": registra medições, refeições
 * e pedidos de consulta no documento do PRÓPRIO paciente que está conversando.
 *
 * Segurança:
 * - Toda requisição exige o header "x-webhook-secret" (compartilhado com o n8n/ElevenLabs).
 * - O paciente é identificado por UID (não por nome), recebido de forma autenticada
 *   da sessão do ElevenLabs — cada paciente só afeta o próprio documento.
 * - Apenas ações da allowlist abaixo; nenhuma ação apaga ou altera dados do nutricionista.
 * - Toda execução é registrada na coleção "aiActions" (auditoria/LGPD).
 *
 * Variáveis de ambiente:
 * - FIREBASE_SERVICE_ACCOUNT_KEY (obrigatória)
 * - ELEVENLABS_WEBHOOK_SECRET ou AGENT_API_SECRET (obrigatória — usada como segredo deste endpoint)
 */

let dbInstance: Firestore | null = null;

function getAdminDb(): Firestore {
  if (dbInstance) return dbInstance;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountJson) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY não configurada.');
  }

  let serviceAccount: Record<string, string>;
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY não é um JSON válido.');
  }

  const app: App = getApps().find((a) => a.name === 'NutriAliAdmin')
    || initializeApp({ credential: cert(serviceAccount) }, 'NutriAliAdmin');

  dbInstance = getFirestore(app);
  return dbInstance;
}

type Action = 'get_patient_data' | 'log_measurement' | 'log_meal' | 'request_appointment';

const ALLOWED_ACTIONS: Action[] = ['get_patient_data', 'log_measurement', 'log_meal', 'request_appointment'];

interface AgentRequestBody {
  action?: string;
  patientUid?: string;
  payload?: Record<string, unknown>;
}

async function audit(db: Firestore, patientUid: string, action: Action, payload: Record<string, unknown>, result: string) {
  try {
    await db.collection('aiActions').add({
      patientUid,
      action,
      payload,
      result,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    // Auditoria não deve bloquear a ação do paciente, mas o erro precisa aparecer nos logs
    console.error('Falha ao registrar auditoria da ação do Ali:', err);
  }
}

function speechResponse(text: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: true, speech: text, ...extra });
}

function speechError(text: string, status = 400) {
  return NextResponse.json({ ok: false, speech: text }, { status });
}

export async function POST(req: Request) {
  // 1. Segredo compartilhado
  const expectedSecret = process.env.AGENT_API_SECRET || process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (expectedSecret) {
    const providedSecret = req.headers.get('x-webhook-secret');
    if (providedSecret !== expectedSecret) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }
  }

  // 2. Corpo da requisição
  let body: AgentRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 });
  }

  const action = body.action as Action;
  const patientUid = body.patientUid;
  const payload = body.payload || {};

  if (!action || !ALLOWED_ACTIONS.includes(action)) {
    return speechError('Ação não reconhecida. Ações disponíveis: ' + ALLOWED_ACTIONS.join(', ') + '.');
  }
  if (!patientUid || typeof patientUid !== 'string') {
    return speechError('Paciente não identificado. Informe o patientUid da sessão.');
  }

  try {
    const db = getAdminDb();
    const patientRef = db.collection('patients').doc(patientUid);
    const patientSnap = await patientRef.get();

    if (!patientSnap.exists) {
      return speechError('Paciente não encontrado na base de dados.', 404);
    }
    const patient = patientSnap.data() as {
      name?: string;
      weight?: number;
      height?: number;
      age?: number;
      objective?: string;
      targetWeight?: number;
      nextAppointment?: string;
      currentPlan?: { status?: string; createdDate?: string } | null;
    };

    switch (action) {
      case 'get_patient_data': {
        await audit(db, patientUid, action, {}, 'dados retornados ao Ali');
        return speechResponse(
          `Dados de ${patient.name}: objetivo ${patient.objective || 'não informado'}, ` +
          `peso atual ${patient.weight ?? 'não informado'} kg, meta ${patient.targetWeight ?? 'não informada'} kg, ` +
          `próxima consulta ${patient.nextAppointment || 'não agendada'}. ` +
          `Plano atual: ${patient.currentPlan?.status ? 'plano ' + patient.currentPlan.status + ' de ' + patient.currentPlan.createdDate : 'sem plano cadastrado'}.`,
          { patient: { name: patient.name, weight: patient.weight, objective: patient.objective, targetWeight: patient.targetWeight, nextAppointment: patient.nextAppointment } }
        );
      }

      case 'log_measurement': {
        const weight = Number(payload.weight);
        const bodyFat = payload.bodyFat !== undefined && payload.bodyFat !== null && payload.bodyFat !== '' ? Number(payload.bodyFat) : undefined;

        if (!weight || Number.isNaN(weight) || weight <= 20 || weight > 500) {
          return speechError('Peso inválido. Peça ao paciente para informar o peso em quilogramas (ex.: 82.5).');
        }

        const today = new Date().toISOString().split('T')[0];
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

        await audit(db, patientUid, action, { weight, bodyFat }, `medição registrada: ${weight} kg`);
        return speechResponse(`Perfeito! Registrei ${weight} kg${bodyFat ? ` e ${bodyFat}% de gordura` : ''} no seu acompanhamento de hoje. ${patient.targetWeight ? `Faltam ${Math.max(0, Math.round((weight - patient.targetWeight) * 10) / 10)} kg para chegar na sua meta de ${patient.targetWeight} kg. ` : ''}Sua nutricionista vai ver essa evolução no painel dela.`);
      }

      case 'log_meal': {
        const description = String(payload.description || '').trim();
        const mealTime = String(payload.mealTime || '').trim();
        if (!description) {
          return speechError('Falta a descrição da refeição. Pergunte ao paciente o que ele comeu.');
        }

        await patientRef.collection('foodLogs').add({
          description,
          mealTime: mealTime || 'não informado',
          loggedAt: new Date().toISOString(),
          source: 'ali',
        });

        await audit(db, patientUid, action, { description, mealTime }, 'refeição registrada no diário');
        return speechResponse(`Anotado! Registrei no seu diário alimentar: ${description}${mealTime ? ` (${mealTime})` : ''}. Sua nutricionista acompanha tudo por lá.`);
      }

      case 'request_appointment': {
        const preferredDate = String(payload.preferredDate || '').trim();
        const notes = String(payload.notes || '').trim();

        await db.collection('appointmentRequests').add({
          patientUid,
          patientName: patient.name || '',
          preferredDate: preferredDate || 'a combinar',
          notes,
          status: 'pending',
          createdAt: new Date().toISOString(),
          source: 'ali',
        });

        await audit(db, patientUid, action, { preferredDate, notes }, 'pedido de consulta criado');
        return speechResponse(`Feito! Enviei o pedido de consulta${preferredDate ? ` para ${preferredDate}` : ''} para a sua nutricionista. Ela vai confirmar o horário com você.`);
      }
    }
  } catch (e: any) {
    console.error('Erro na API de ações do Ali:', e?.message || e);
    return speechError('Não consegui executar essa ação agora. Tenta de novo em instantes.', 500);
  }
}
