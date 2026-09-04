import { NextResponse } from 'next/server';
import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

/**
 * Webhook da ElevenLabs para consulta de pacientes.
 *
 * Usa o Firebase Admin SDK com conta de serviço (bypassa as regras do Firestore,
 * que agora restringem leitura de pacientes ao próprio paciente ou ao nutricionista).
 *
 * Variáveis de ambiente necessárias (configurar no painel da Vercel):
 * - FIREBASE_SERVICE_ACCOUNT_KEY: JSON completo da conta de serviço (Firebase Console
 *   → Configurações do projeto → Contas de serviço → Gerar nova chave privada).
 * - ELEVENLABS_WEBHOOK_SECRET (opcional, recomendado): segredo compartilhado enviado
 *   no header "x-webhook-secret" pela configuração do webhook da ElevenLabs.
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

export async function POST(req: Request) {
  // Verificação opcional de segredo compartilhado
  const expectedSecret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (expectedSecret) {
    const providedSecret = req.headers.get('x-webhook-secret');
    if (providedSecret !== expectedSecret) {
      return NextResponse.json(
        { error: 'Não autorizado.' },
        { status: 401 }
      );
    }
  }

  let nomePaciente = '';
  try {
    const body = await req.json();
    nomePaciente = body?.nomePaciente || '';
  } catch {
    return NextResponse.json(
      { error: 'Corpo da requisição inválido.' },
      { status: 400 }
    );
  }

  if (!nomePaciente) {
    return NextResponse.json(
      { error: 'O parâmetro nomePaciente é obrigatório.' },
      { status: 400 }
    );
  }

  try {
    const db = getAdminDb();

    // Busca pacientes pelo banco com a conta de serviço (sem depender de auth do cliente)
    const snap = await db.collection('patients').get();
    const patients: any[] = [];
    snap.forEach((doc) => {
      patients.push({ id: doc.id, ...doc.data() });
    });

    const patient = patients.find((p) =>
      p.name && p.name.toLowerCase().includes(nomePaciente.toLowerCase())
    );

    if (patient) {
      return NextResponse.json({
        encontrado: true,
        nome: patient.name,
        idade: patient.age,
        objetivo: patient.objective,
        pesoAtual: patient.weight,
        pesoMeta: patient.targetWeight,
        proximaConsulta: patient.nextAppointment || 'Nenhuma consulta agendada',
        planoAtual: patient.currentPlan
          ? `Status: ${patient.currentPlan.status}. Criado em: ${patient.currentPlan.createdDate}`
          : 'Sem plano atual cadastrado.'
      });
    } else {
      return NextResponse.json({
        encontrado: false,
        mensagem: `Paciente com o nome ${nomePaciente} não foi encontrado na base de dados.`
      });
    }
  } catch (e: any) {
    console.error('Erro no webhook de pacientes:', e?.message || e);
    return NextResponse.json(
      {
        error:
          'Serviço temporariamente indisponível. Verifique a configuração da conta de serviço (FIREBASE_SERVICE_ACCOUNT_KEY).'
      },
      { status: 500 }
    );
  }
}
