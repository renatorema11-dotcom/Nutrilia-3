import { NextResponse } from 'next/server';
import { MOCK_PATIENTS_LIST } from '@/lib/mock-data';

// Este é um Webhook Tool para o agente da ElevenLabs
// A IA fará uma requisição POST para este endpoint enviando o nome do paciente.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    
    // A IA da ElevenLabs vai enviar os argumentos que configurarmos no painel.
    // Exemplo: se configurarmos um parâmetro chamado "nomePaciente" na tool.
    const { nomePaciente } = body;
    
    if (!nomePaciente) {
      return NextResponse.json({ 
        error: 'O parâmetro nomePaciente é obrigatório.' 
      }, { status: 400 });
    }

    // Busca o paciente no nosso "banco de dados" (mock data)
    const patient = MOCK_PATIENTS_LIST.find(p => 
      p.name.toLowerCase().includes(nomePaciente.toLowerCase())
    );

    if (patient) {
      // Retorna os dados do paciente para que a IA possa ler e responder
      return NextResponse.json({
        encontrado: true,
        nome: patient.name,
        idade: patient.age,
        objetivo: patient.objective,
        pesoInicial: patient.initialWeight,
        pesoMeta: patient.targetWeight,
        proximaConsulta: patient.nextAppointment,
        planoAtual: patient.currentPlan 
          ? `Status: ${patient.currentPlan.status}. Criado em: ${patient.currentPlan.createdDate}`
          : 'Sem plano atual.'
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

