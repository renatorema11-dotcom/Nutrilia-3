import { getAdminDb, json, verifyCaller } from '@/lib/firebase-admin';
import { allowRequest } from '@/lib/ai-guard';
import { exportPatientData } from '@/lib/account-privacy';
import { reportServerError } from '@/lib/server-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** "Baixar meus dados": o paciente logado recebe um arquivo com o que o app guarda sobre ele. */
export async function GET(req: Request) {
  const caller = await verifyCaller(req);
  if (!caller || caller.role !== 'patient') return json({ error: 'Entre com a sua conta de paciente.' }, 403);
  if (!allowRequest(`export:${caller.uid}`, 5)) return json({ error: 'Você já baixou os seus dados há pouco. Aguarde alguns minutos.' }, 429);
  try {
    const now = new Date();
    const data = await exportPatientData(getAdminDb(), caller.uid, now);
    return new Response(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="nutriali-meus-dados-${now.toISOString().slice(0, 10)}.json"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    reportServerError('Exportação: falha ao reunir os dados.', error);
    return json({ error: 'Não foi possível reunir os seus dados agora. Tente de novo em instantes.' }, 503);
  }
}
