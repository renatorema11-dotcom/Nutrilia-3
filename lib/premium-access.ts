// Premium no servidor: as rotas pagas conferem o banco (a tela travada sozinha não basta), e o responsável
// pelo NutriAli pode dar Premium de cortesia (contas de demonstração, testes, parcerias).
import type { Firestore } from 'firebase-admin/firestore';
import { isPremiumActive } from './premium';

/** O paciente tem Premium valendo agora? Em caso de dúvida (prontuário que não existe), não. */
export async function hasPremium(db: Firestore, uid: string, now = Date.now()): Promise<boolean> {
  const snap = await db.collection('patients').doc(uid).get();
  return snap.exists && isPremiumActive(snap.data()?.premium, now);
}

const MAX_COURTESY_DAYS = 366;

/** Cortesia de Premium por alguns dias para o paciente deste e-mail. Zero dias tira a cortesia. */
export async function grantCourtesy(db: Firestore, emailValue: unknown, daysValue: unknown, now = new Date()) {
  const typed = typeof emailValue === 'string' ? emailValue.trim() : '';
  const email = typed.toLowerCase();
  const days = typeof daysValue === 'number' ? Math.floor(daysValue) : NaN;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false as const, status: 422, error: 'Informe o e-mail do paciente.' };
  if (!Number.isFinite(days) || days < 0 || days > MAX_COURTESY_DAYS) return { ok: false as const, status: 422, error: `Escolha de 0 a ${MAX_COURTESY_DAYS} dias.` };
  // O prontuário guarda o e-mail como foi digitado no cadastro: tenta assim e, se não achar, em minúsculas.
  let snap = await db.collection('patients').where('email', '==', typed).get();
  if (!snap.docs.length && typed !== email) snap = await db.collection('patients').where('email', '==', email).get();
  if (!snap.docs.length) return { ok: false as const, status: 404, error: 'Nenhum paciente com este e-mail.' };
  if (snap.docs.length > 1) return { ok: false as const, status: 409, error: 'Há mais de um prontuário com este e-mail. Resolva antes de dar a cortesia.' };
  const until = days ? new Date(now.getTime() + days * 86_400_000).toISOString() : null;
  await snap.docs[0].ref.update({ 'premium.courtesyUntil': until, 'premium.updatedAt': now.toISOString() });
  return { ok: true as const, name: String(snap.docs[0].data()?.name || email), until };
}
