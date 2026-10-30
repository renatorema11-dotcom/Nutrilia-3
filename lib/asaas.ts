// Assinatura do NutriAli Premium (paciente) e avisos de pagamento do Asaas (webhook), do Premium e das consultas.
// O Asaas avisa os pagamentos em /api/asaas/webhook, com o token de ASAAS_WEBHOOK_TOKEN no cabeçalho.
import { timingSafeEqual } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { AsaasError, asaasRequest, ensureCustomer, todayInBrasilia, type AsaasRequest } from './asaas-client';
import { CONSULTATION_REFERENCE, settleConsultationPayment } from './consultation-payments';
import { PREMIUM_PRICE, extendPaidUntil, isPremiumActive } from './premium';

/** Link da cobrança em aberto de uma assinatura, para o paciente pagar (Pix, cartão ou boleto). */
async function openInvoice(request: AsaasRequest, subscriptionId: string): Promise<string | null> {
  try {
    const list = await request(`/subscriptions/${encodeURIComponent(subscriptionId)}/payments`);
    const open = (Array.isArray(list?.data) ? list.data : []).find((payment: any) => payment?.status === 'PENDING' || payment?.status === 'OVERDUE');
    return typeof open?.invoiceUrl === 'string' ? open.invoiceUrl : null;
  } catch (error) {
    // Assinatura que não existe mais no Asaas: o paciente assina de novo.
    if (error instanceof AsaasError && error.status === 404) return null;
    throw error;
  }
}

type PremiumResult = { ok: true; invoiceUrl: string } | { ok: false; status: number; error: string; needCpf?: true };

/**
 * Assinatura do Premium: cria o cliente no Asaas (com o CPF, que não fica guardado no NutriAli) e a assinatura
 * mensal, e devolve o link da primeira cobrança. Quem já tem assinatura com cobrança em aberto recebe esse link.
 * O Premium só liga quando o Asaas confirma o pagamento (webhook).
 */
export async function startPremium(
  db: Firestore, uid: string, buyer: { email: string; cpf: string | null }, request: AsaasRequest = asaasRequest, now = new Date(),
): Promise<PremiumResult> {
  const patientRef = db.collection('patients').doc(uid);
  const patientSnap = await patientRef.get();
  if (!patientSnap.exists) return { ok: false, status: 404, error: 'Conclua o seu cadastro antes de assinar o Premium.' };
  const name = String(patientSnap.data()?.name || '').trim() || buyer.email;
  const billingRef = db.collection('billing').doc(uid);
  const billing = (await billingRef.get()).data() || {};

  if (typeof billing.premiumSubscriptionId === 'string' && billing.premiumSubscriptionId) {
    const pending = await openInvoice(request, billing.premiumSubscriptionId);
    if (pending) return { ok: true, invoiceUrl: pending };
    if (isPremiumActive(patientSnap.data()?.premium, now.getTime())) {
      return { ok: false, status: 409, error: 'O seu Premium já está ativo. A próxima cobrança chega por e-mail perto do vencimento.' };
    }
  }

  const customer = await ensureCustomer(db, uid, { name, email: buyer.email, cpf: buyer.cpf }, request, now);
  if (!customer.ok) return customer;

  const subscription = await request('/subscriptions', {
    method: 'POST',
    body: {
      customer: customer.customer,
      billingType: 'UNDEFINED',
      value: PREMIUM_PRICE,
      nextDueDate: todayInBrasilia(now),
      cycle: 'MONTHLY',
      description: 'NutriAli Premium',
      externalReference: `premium:${uid}`,
    },
  });
  if (typeof subscription?.id !== 'string') throw new AsaasError('O Asaas não devolveu a assinatura.', 502);
  await billingRef.set({ premiumSubscriptionId: subscription.id, updatedAt: now.toISOString() }, { merge: true });
  await patientRef.update({ 'premium.subscriptionActive': true, 'premium.updatedAt': now.toISOString() });

  const invoiceUrl = await openInvoice(request, subscription.id);
  if (!invoiceUrl) return { ok: false, status: 502, error: 'A assinatura foi criada, mas o link de pagamento ainda não saiu. Tente de novo em instantes.' };
  return { ok: true, invoiceUrl };
}

/** Cancela a assinatura no Asaas. O Premium continua até o fim do mês já pago. */
export async function cancelPremium(db: Firestore, uid: string, request: AsaasRequest = asaasRequest, now = new Date()) {
  const billingRef = db.collection('billing').doc(uid);
  const subscriptionId = (await billingRef.get()).data()?.premiumSubscriptionId;
  if (typeof subscriptionId !== 'string' || !subscriptionId) return { ok: false as const, status: 404, error: 'Você não tem assinatura do Premium para cancelar.' };
  try {
    await request(`/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: 'DELETE' });
  } catch (error) {
    if (!(error instanceof AsaasError && error.status === 404)) throw error;
  }
  await billingRef.set({ premiumSubscriptionId: null, updatedAt: now.toISOString() }, { merge: true });
  await db.collection('patients').doc(uid).update({ 'premium.subscriptionActive': false, 'premium.updatedAt': now.toISOString() });
  return { ok: true as const };
}

/** O webhook só é aceito com o token combinado no painel do Asaas (cabeçalho asaas-access-token). */
export function webhookAuthorized(provided: string | null, expected = process.env.ASAAS_WEBHOOK_TOKEN): boolean {
  if (!expected || expected.length < 16 || !provided || provided.length > 4096) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Paciente dono de uma cobrança do Premium: pela referência "premium:<uid>" ou pela assinatura guardada em billing. */
async function premiumOwner(db: Firestore, payment: any): Promise<string | null> {
  const reference = typeof payment?.externalReference === 'string' ? payment.externalReference : '';
  if (reference.startsWith('premium:')) return reference.slice(8) || null;
  if (typeof payment?.subscription !== 'string' || !payment.subscription) return null;
  const snap = await db.collection('billing').where('premiumSubscriptionId', '==', payment.subscription).get();
  return snap.docs[0]?.id || null;
}

/** Código da consulta paga ("consulta:<código>"), ou ''. */
function consultationId(payment: any): string {
  const reference = typeof payment?.externalReference === 'string' ? payment.externalReference : '';
  return reference.startsWith(CONSULTATION_REFERENCE) ? reference.slice(CONSULTATION_REFERENCE.length) : '';
}

const PAID = new Set(['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH']);
// Cobrança apagada (PAYMENT_DELETED) não entra: ao cancelar, o Asaas apaga as cobranças futuras, e o mês já pago continua valendo.
const REVERSED = new Set(['PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_CHARGEBACK_DISPUTE']);

/**
 * Trata um aviso do Asaas. Cada aviso é tratado uma vez só (o Asaas pode repetir). O pagamento é conferido de
 * novo na API do Asaas antes de liberar o Premium ou dar a consulta como paga: o corpo do aviso sozinho não basta.
 */
export async function handleAsaasEvent(db: Firestore, event: any, request: AsaasRequest = asaasRequest, now = new Date()): Promise<string> {
  const id = typeof event?.id === 'string' ? event.id.slice(0, 200) : '';
  const type = typeof event?.event === 'string' ? event.event : '';
  if (!id || !type) return 'ignorado';
  const marker = db.collection('asaasEvents').doc(id.replace(/\//g, '_'));
  if ((await marker.get()).exists) return 'repetido';

  let result = 'ignorado';
  const paymentId = typeof event.payment?.id === 'string' ? event.payment.id : '';
  if ((type === 'PAYMENT_CONFIRMED' || type === 'PAYMENT_RECEIVED') && paymentId) {
    const payment = await request(`/payments/${encodeURIComponent(paymentId)}`);
    const consultation = PAID.has(payment?.status) ? consultationId(payment) : '';
    const uid = PAID.has(payment?.status) && !consultation ? await premiumOwner(db, payment) : null;
    if (consultation) {
      if (await settleConsultationPayment(db, consultation, payment, 'paid', now)) result = 'consulta paga';
    } else if (uid) {
      const ref = db.collection('patients').doc(uid);
      const snap = await ref.get();
      if (snap.exists) {
        const current = snap.data()?.premium?.paidUntil;
        await ref.update({ 'premium.paidUntil': extendPaidUntil(current, payment.dueDate, now), 'premium.updatedAt': now.toISOString() });
        result = 'premium liberado';
      }
    }
  } else if (REVERSED.has(type) && paymentId) {
    const consultation = consultationId(event.payment);
    if (consultation) {
      if (await settleConsultationPayment(db, consultation, event.payment, 'refunded', now)) result = 'consulta estornada';
    } else {
      // Estorno ou contestação de um mês pago: o Premium daquele pagamento deixa de valer.
      const uid = await premiumOwner(db, event.payment);
      if (uid && (await db.collection('patients').doc(uid).get()).exists) {
        await db.collection('patients').doc(uid).update({ 'premium.paidUntil': now.toISOString(), 'premium.updatedAt': now.toISOString() });
        result = 'premium retirado';
      }
    }
  } else if (type === 'SUBSCRIPTION_DELETED' || type === 'SUBSCRIPTION_INACTIVATED') {
    const uid = await premiumOwner(db, { subscription: event.subscription?.id });
    if (uid && (await db.collection('patients').doc(uid).get()).exists) {
      await db.collection('patients').doc(uid).update({ 'premium.subscriptionActive': false, 'premium.updatedAt': now.toISOString() });
      result = 'assinatura encerrada';
    }
  }
  await marker.set({ event: type, result, at: now.toISOString() });
  return result;
}
