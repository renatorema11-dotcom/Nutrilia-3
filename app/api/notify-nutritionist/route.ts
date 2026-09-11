import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { collection, addDoc, doc, setDoc } from 'firebase/firestore';

export async function POST(req: NextRequest) {
  try {
    const { nutritionistId, nutritionistEmail, nutritionistName, patientId, patientName, patientEmail } = await req.json();

    if (!nutritionistEmail || !patientName) {
      return NextResponse.json({ error: 'Dados incompletos' }, { status: 400 });
    }

    const timestamp = new Date().toISOString();
    const notificationData = {
      type: 'HiredNotification',
      nutritionistId: nutritionistId || '',
      nutritionistEmail,
      nutritionistName: nutritionistName || 'Nutricionista',
      patientId: patientId || '',
      patientName: patientName || 'Novo Paciente',
      patientEmail: patientEmail || '',
      title: '🎉 Novo Paciente Contratou Seus Serviços!',
      message: `O paciente ${patientName} (${patientEmail}) acabou de contratar seu acompanhamento nutricional no NutriAli.`,
      status: 'sent',
      createdAt: timestamp,
      read: false
    };

    // Save notification log in Firestore
    try {
      await addDoc(collection(db, 'notifications'), notificationData);
      if (nutritionistId) {
        await addDoc(collection(db, 'users', nutritionistId, 'notifications'), notificationData);
      }
    } catch (e) {
      console.warn('Could not save notification to Firestore:', e);
    }

    // Simulated email delivery log
    console.log(`[EMAIL SIMULATOR] Sent email to ${nutritionistEmail}:`, {
      subject: `[NutriAli] ${patientName} contratou seus serviços de nutrição!`,
      body: `Olá ${nutritionistName},\n\nO paciente ${patientName} (${patientEmail}) selecionou você como seu nutricionista responsável.\nVocê pode acessar a ficha e o chat do paciente na sua área de trabalho do NutriAli.`
    });

    return NextResponse.json({
      success: true,
      message: `Notificação por e-mail simulada e enviada com sucesso para ${nutritionistEmail}!`,
      notification: notificationData
    });
  } catch (error: any) {
    console.error('Error in notify-nutritionist:', error);
    return NextResponse.json({ error: error?.message || 'Erro interno' }, { status: 500 });
  }
}
