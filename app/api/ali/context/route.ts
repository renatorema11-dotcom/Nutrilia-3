import { getAdminDb, json, verifyCaller } from '@/lib/firebase-admin';
import { connectionStatus, loadSettings } from '@/lib/google-workspace';
import { cleanText, describeAttendance, describeClinic } from '@/lib/ali-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Variáveis da conversa com a Ali: a personalização da nutricionista do paciente logado. */
export async function GET(req: Request) {
  const caller = await verifyCaller(req);
  if (!caller || caller.role !== 'patient') return json({ error: 'Acesso permitido só para pacientes.' }, 403);
  try {
    const db = getAdminDb();
    const patientSnap = await db.collection('patients').doc(caller.uid).get();
    const patient = patientSnap.exists ? patientSnap.data() || {} : {};
    const firstName = cleanText(String(patient.name || '').split(' ')[0], 40);
    const nutritionistId = typeof patient.nutritionistId === 'string' ? patient.nutritionistId : '';
    if (!nutritionistId) {
      return json({ dynamicVariables: {
        patientFirstName: firstName || 'tudo bem',
        nutritionistName: 'sua nutricionista',
        attendanceInfo: 'Você ainda não tem uma nutricionista vinculada.',
        clinicInfo: 'Nenhuma informação do consultório cadastrada.',
        nutritionistGuidelines: 'Nenhuma orientação adicional.',
        agendaStatus: 'nao_conectada',
      } });
    }
    const [settings, google] = await Promise.all([loadSettings(db, nutritionistId), connectionStatus(db, nutritionistId)]);
    return json({ dynamicVariables: {
      patientFirstName: firstName || 'tudo bem',
      nutritionistName: settings.displayName || 'sua nutricionista',
      attendanceInfo: describeAttendance(settings),
      clinicInfo: describeClinic(settings) || 'Nenhuma informação do consultório cadastrada.',
      nutritionistGuidelines: settings.guidelines || 'Nenhuma orientação adicional.',
      agendaStatus: google.connected && google.configured ? 'conectada' : 'nao_conectada',
    } });
  } catch {
    return json({ error: 'Não foi possível carregar a Ali agora.' }, 503);
  }
}
