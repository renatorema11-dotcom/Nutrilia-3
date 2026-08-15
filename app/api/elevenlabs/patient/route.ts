import { NextResponse } from 'next/server';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { nomePaciente } = body;

    if (!nomePaciente) {
      return NextResponse.json({
        error: 'O parâmetro nomePaciente é obrigatório.'
      }, { status: 400 });
    }

    // Busca o paciente no banco de dados do Firestore
    let patients: any[] = [];
    try {
      const snap = await getDocs(collection(db, 'patients'));
      snap.forEach((doc) => {
        patients.push({ id: doc.id, ...doc.data() });
      });
    } catch (e) {
      console.warn('Erro ao consultar Firestore no webhook:', e);
    }

    const patient = patients.find(p =>
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

  } catch (error) {
    console.error("Erro no Webhook ElevenLabs:", error);
    return NextResponse.json({ error: 'Erro ao processar a requisição' }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return POST(req);
}
