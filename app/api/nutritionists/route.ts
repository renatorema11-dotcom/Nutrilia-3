import { getAdminDb, json, verifyCaller } from '@/lib/firebase-admin';
import { approvalOf } from '@/lib/nutritionist-approval';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * Lista de nutricionistas para o paciente escolher. Só sai o perfil profissional;
 * o resto do cadastro de cada uma (agenda, anotações, configurações) nunca sai do servidor.
 */
export async function GET(req: Request) {
  const caller = await verifyCaller(req);
  if (!caller) return json({ error: 'Entre novamente no aplicativo.' }, 401);
  try {
    const snap = await getAdminDb().collection('users').where('role', '==', 'nutritionist').get();
    // Cadastro em análise ou recusado não aparece para os pacientes.
    const nutritionists = snap.docs.filter((doc) => approvalOf(doc.data()) === 'approved').map((doc) => {
      const d = doc.data() || {};
      // Foto grande demais fica de fora inteira (cortar uma imagem embutida a estragaria).
      const rawPhoto = typeof d.photoURL === 'string' ? d.photoURL.trim() : '';
      const photo = rawPhoto.length <= 400_000 ? rawPhoto : '';
      return {
        id: doc.id,
        displayName: text(d.displayName, 120) || text(d.name, 120) || 'Nutricionista',
        email: text(d.email, 254),
        crn: text(d.crn, 40),
        specialty: text(d.specialty, 120) || 'Nutrição Clínica',
        // Foto por endereço (https) ou embutida (data:image); qualquer outra coisa fica de fora.
        photoURL: /^(https:\/\/|data:image\/)/.test(photo) ? photo : '',
        phone: text(d.phone, 40),
        bio: text(d.bio, 1000),
      };
    });
    return json({ nutritionists });
  } catch {
    return json({ error: 'Não foi possível carregar a lista agora.' }, 503);
  }
}
