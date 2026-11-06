// Consultas pagas pelo app. O paciente paga no Asaas e a divisão é automática: 90% do valor líquido (já sem a taxa
// do Asaas) vão para a carteira da nutricionista e 10% ficam com o NutriAli. Somente no servidor.
// nutritionistPayments/{uid}: preço da consulta e carteira; consultationPayments/{nutri_consulta}: cada cobrança.
import type { Firestore } from 'firebase-admin/firestore';
import { AsaasError, asaasRequest, ensureCustomer, todayInBrasilia, type AsaasRequest } from './asaas-client';
import { validCpf } from './premium';

export const COMMISSION_PERCENT = 10;
export const NUTRITIONIST_PERCENT = 100 - COMMISSION_PERCENT;
export const CONSULTATION_REFERENCE = 'consulta:';
export const MIN_CONSULTATION_PRICE = 10;
export const MAX_CONSULTATION_PRICE = 5000;
const SETTINGS = 'nutritionistPayments';
const PAYMENTS = 'consultationPayments';
const WALLET_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMPANY_TYPES = new Set(['MEI', 'LIMITED', 'INDIVIDUAL', 'ASSOCIATION']);

type Fail = { ok: false; status: number; error: string; needCpf?: true };

export interface PaymentSettings { consultationPrice: number | null; walletId: string | null; subaccountId: string | null }

/** Valor em reais digitado como "1.500,00", "150,5" ou "150.00" (com vírgula, o ponto é separador de milhar). */
function parseAmount(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return NaN;
  const text = value.trim().replace(/^R\$\s*/i, '');
  return Number(text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text);
}

/** Preço válido da consulta (de R$ 10 a R$ 5.000), em reais com centavos, ou null. */
export function validPrice(value: unknown): number | null {
  const number = parseAmount(value);
  if (!Number.isFinite(number) || number < MIN_CONSULTATION_PRICE || number > MAX_CONSULTATION_PRICE) return null;
  return Math.round(number * 100) / 100;
}

/** Divide um valor entre a nutricionista (90%) e a comissão (10%), em centavos, sem sobrar nem faltar centavo. */
export function splitValue(value: number): { nutritionist: number; commission: number } {
  const cents = Math.round(value * 100);
  const commission = Math.round((cents * COMMISSION_PERCENT) / 100);
  return { nutritionist: (cents - commission) / 100, commission: commission / 100 };
}

/** CNPJ só com os números, se os dígitos verificadores baterem; senão, null. */
export function validCnpj(value: unknown): string | null {
  const digits = typeof value === 'string' ? value.replace(/\D/g, '') : '';
  if (digits.length !== 14 || /^(\d)\1{13}$/.test(digits)) return null;
  const check = (length: number) => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, i) => total + Number(digits[i]) * weight, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(12) === Number(digits[12]) && check(13) === Number(digits[13]) ? digits : null;
}

export async function loadPaymentSettings(db: Firestore, uid: string): Promise<PaymentSettings> {
  const data = (await db.collection(SETTINGS).doc(uid).get()).data() || {};
  return {
    consultationPrice: validPrice(data.consultationPrice),
    walletId: typeof data.walletId === 'string' && WALLET_RE.test(data.walletId) ? data.walletId : null,
    subaccountId: typeof data.subaccountId === 'string' && data.subaccountId ? data.subaccountId : null,
  };
}

/** A nutricionista recebe pelo app quando tem o preço da consulta e a carteira do Asaas. */
export function paymentsEnabled(settings: PaymentSettings): boolean {
  return settings.consultationPrice !== null && settings.walletId !== null;
}

export async function savePrice(db: Firestore, uid: string, value: unknown, now = new Date()): Promise<{ ok: true; price: number } | Fail> {
  const price = validPrice(value);
  if (price === null) return { ok: false, status: 422, error: `Informe um valor entre R$ ${MIN_CONSULTATION_PRICE} e R$ ${MAX_CONSULTATION_PRICE.toLocaleString('pt-BR')}.` };
  await db.collection(SETTINGS).doc(uid).set({ consultationPrice: price, updatedAt: now.toISOString() }, { merge: true });
  return { ok: true, price };
}

/** Quem já tem conta no Asaas informa a carteira (Wallet ID) dela, sem criar subconta. */
export async function linkWallet(db: Firestore, uid: string, value: unknown, now = new Date()): Promise<{ ok: true } | Fail> {
  const walletId = typeof value === 'string' ? value.trim() : '';
  if (!WALLET_RE.test(walletId)) return { ok: false, status: 422, error: 'Confira o Wallet ID: ele tem o formato 0000aaaa-00aa-00aa-00aa-000000aaaaaa.' };
  await db.collection(SETTINGS).doc(uid).set({ walletId: walletId.toLowerCase(), subaccountId: null, updatedAt: now.toISOString() }, { merge: true });
  return { ok: true };
}

const field = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * Cria a subconta da nutricionista no Asaas do NutriAli, para ela receber os 90%. Os dados (CPF ou CNPJ, endereço,
 * renda) vão só para o Asaas; o NutriAli guarda apenas a carteira e o código da subconta. O Asaas manda à
 * nutricionista o e-mail para ela entrar na conta dela e sacar.
 */
export async function createSubaccount(
  db: Firestore, uid: string, owner: { name: string; email: string }, input: Record<string, unknown>,
  request: AsaasRequest = asaasRequest, now = new Date(),
): Promise<{ ok: true } | Fail> {
  if ((await loadPaymentSettings(db, uid)).walletId) return { ok: false, status: 409, error: 'A sua conta para receber já está ativa.' };
  const cpf = validCpf(input.document);
  const cnpj = cpf ? null : validCnpj(input.document);
  if (!cpf && !cnpj) return { ok: false, status: 422, error: 'Confira o CPF ou o CNPJ.' };
  const birthDate = field(input.birthDate, 10);
  if (cpf) {
    const born = Date.parse(`${birthDate}T12:00:00Z`);
    const adult = Number.isFinite(born) && now.getTime() - born >= 18 * 365.25 * 86_400_000;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !adult) return { ok: false, status: 422, error: 'Informe a data de nascimento (é preciso ter 18 anos ou mais).' };
  }
  const companyType = field(input.companyType, 20);
  if (cnpj && !COMPANY_TYPES.has(companyType)) return { ok: false, status: 422, error: 'Escolha o tipo da empresa.' };
  const mobilePhone = field(input.mobilePhone, 30).replace(/\D/g, '');
  if (mobilePhone.length < 10 || mobilePhone.length > 11) return { ok: false, status: 422, error: 'Informe o celular com DDD.' };
  const income = parseAmount(input.incomeValue);
  if (!Number.isFinite(income) || income <= 0 || income > 100_000_000) return { ok: false, status: 422, error: 'Informe a renda ou o faturamento mensal aproximado.' };
  const incomeValue = Math.round(income * 100) / 100;
  const postalCode = field(input.postalCode, 12).replace(/\D/g, '');
  if (postalCode.length !== 8) return { ok: false, status: 422, error: 'Confira o CEP.' };
  const address = field(input.address, 120);
  const addressNumber = field(input.addressNumber, 20);
  const province = field(input.province, 80);
  if (!address || !addressNumber || !province) return { ok: false, status: 422, error: 'Preencha a rua, o número e o bairro.' };

  const account = await request('/accounts', {
    method: 'POST',
    body: {
      name: owner.name.slice(0, 100),
      email: owner.email,
      cpfCnpj: cpf || cnpj,
      ...(cpf ? { birthDate } : { companyType }),
      mobilePhone,
      incomeValue,
      postalCode: `${postalCode.slice(0, 5)}-${postalCode.slice(5)}`,
      address,
      addressNumber,
      ...(field(input.complement, 80) ? { complement: field(input.complement, 80) } : {}),
      province,
    },
  });
  if (typeof account?.walletId !== 'string' || !WALLET_RE.test(account.walletId)) throw new AsaasError('O Asaas não devolveu a carteira da subconta.', 502);
  await db.collection(SETTINGS).doc(uid).set({
    walletId: account.walletId.toLowerCase(), subaccountId: typeof account.id === 'string' ? account.id : null, updatedAt: now.toISOString(),
  }, { merge: true });
  return { ok: true };
}

/** O que o paciente precisa saber para pagar: se a nutricionista dele recebe pelo app e quanto custa. */
export async function patientPaymentInfo(db: Firestore, patientUid: string) {
  const patient = (await db.collection('patients').doc(patientUid).get()).data() || {};
  const nutritionistId = typeof patient.nutritionistId === 'string' ? patient.nutritionistId : '';
  if (!nutritionistId) return { enabled: false, price: null };
  const settings = await loadPaymentSettings(db, nutritionistId);
  return { enabled: paymentsEnabled(settings), price: settings.consultationPrice };
}

/** Código da cobrança: um por consulta, para a mesma consulta nunca ser cobrada duas vezes. */
export function paymentDocId(nutritionistId: string, appointmentId: string): string {
  return `${nutritionistId}_${appointmentId}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 400);
}

/** Atualiza o pagamento na consulta das listas que o app mostra (paciente e nutricionista). */
async function patchEntries(db: Firestore, uids: string[], appointmentId: string, payment: Record<string, unknown>) {
  for (const uid of uids) {
    if (!uid) continue;
    const ref = db.collection('users').doc(uid);
    const list = (await ref.get()).data()?.appointments;
    if (!Array.isArray(list) || !list.some((entry) => entry?.id === appointmentId)) continue;
    await ref.set({ appointments: list.map((entry) => (entry?.id === appointmentId ? { ...entry, payment } : entry)) }, { merge: true });
  }
}

/**
 * A consulta da lista da nutricionista é deste paciente? A marcada à mão traz o paciente na própria lista; a marcada
 * pela Ali é conferida no registro da agenda da Ali (aliAppointments/<nutricionista>_<evento>, ver lib/google-workspace.ts).
 */
async function belongsToPatient(db: Firestore, nutritionistId: string, patientUid: string, entry: Record<string, unknown>): Promise<boolean> {
  if (entry.source !== 'ali') return entry.patientUid === patientUid;
  const record = (await db.collection('aliAppointments').doc(`${nutritionistId}_${entry.id}`).get()).data();
  return record?.patientUid === patientUid && record?.status === 'scheduled';
}

/**
 * Cobrança de uma consulta pelo paciente. A consulta é conferida na lista da NUTRICIONISTA (que o paciente não
 * consegue alterar): só paga quem tem consulta marcada com ela. O valor é o preço atual da nutricionista.
 */
export async function startConsultationPayment(
  db: Firestore, patientUid: string, email: string, input: Record<string, unknown>,
  request: AsaasRequest = asaasRequest, now = new Date(),
): Promise<{ ok: true; invoiceUrl: string } | Fail> {
  const appointmentId = typeof input.appointmentId === 'string' ? input.appointmentId.slice(0, 200) : '';
  if (!appointmentId) return { ok: false, status: 400, error: 'Dados inválidos.' };
  const patient = (await db.collection('patients').doc(patientUid).get()).data();
  const nutritionistId = typeof patient?.nutritionistId === 'string' ? patient.nutritionistId : '';
  if (!patient || !nutritionistId) return { ok: false, status: 409, error: 'Escolha a sua nutricionista antes de pagar uma consulta.' };
  const settings = await loadPaymentSettings(db, nutritionistId);
  if (!paymentsEnabled(settings)) return { ok: false, status: 409, error: 'A sua nutricionista ainda não recebe pagamentos pelo app. Combine o pagamento com ela.' };

  const list = (await db.collection('users').doc(nutritionistId).get()).data()?.appointments;
  const entry = Array.isArray(list) ? list.find((item) => item?.id === appointmentId && item?.status === 'Agendada') : null;
  if (!entry || !(await belongsToPatient(db, nutritionistId, patientUid, entry))) {
    return { ok: false, status: 404, error: 'Consulta não encontrada. Atualize a página e tente de novo.' };
  }

  const docId = paymentDocId(nutritionistId, appointmentId);
  const ref = db.collection(PAYMENTS).doc(docId);
  const existing = (await ref.get()).data();
  if (existing?.status === 'paid') return { ok: false, status: 409, error: 'Esta consulta já está paga.' };
  if (existing?.status === 'pending' && typeof existing.invoiceUrl === 'string') return { ok: true, invoiceUrl: existing.invoiceUrl };

  const name = String(patient.name || '').trim() || email;
  const customer = await ensureCustomer(db, patientUid, { name, email, cpf: validCpf(input.cpf) }, request, now);
  if (!customer.ok) return customer;

  const value = settings.consultationPrice as number;
  const [year, month, day] = String(entry.date || '').split('-');
  const payment = await request('/payments', {
    method: 'POST',
    body: {
      customer: customer.customer,
      billingType: 'UNDEFINED',
      value,
      dueDate: todayInBrasilia(now, 3),
      description: `Consulta nutricional em ${day}/${month}/${year} às ${entry.time}`,
      externalReference: CONSULTATION_REFERENCE + docId,
      // 90% do valor líquido vão direto para a carteira da nutricionista; o resto fica na conta do NutriAli.
      split: [{ walletId: settings.walletId, percentualValue: NUTRITIONIST_PERCENT }],
    },
  });
  if (typeof payment?.id !== 'string' || typeof payment?.invoiceUrl !== 'string') throw new AsaasError('O Asaas não devolveu a cobrança.', 502);
  await ref.set({
    nutritionistId, patientUid, patientName: name.slice(0, 120), appointmentId,
    appointmentDate: String(entry.date || ''), appointmentTime: String(entry.time || ''),
    value, status: 'pending', asaasPaymentId: payment.id, invoiceUrl: payment.invoiceUrl,
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  });
  await patchEntries(db, [patientUid, nutritionistId], appointmentId, { status: 'pending', value });
  return { ok: true, invoiceUrl: payment.invoiceUrl };
}

/** Pagamento confirmado ou estornado pelo Asaas (chamado pelo webhook). Devolve false se a cobrança não for do app. */
export async function settleConsultationPayment(db: Firestore, docId: string, payment: any, kind: 'paid' | 'refunded', now = new Date()): Promise<boolean> {
  const ref = db.collection(PAYMENTS).doc(docId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const data = snap.data() || {};
  if (kind === 'paid' && data.status === 'paid') return true;
  const netValue = typeof payment?.netValue === 'number' && payment.netValue > 0 ? payment.netValue : null;
  await ref.update(kind === 'paid'
    ? { status: 'paid', paidAt: now.toISOString(), netValue, updatedAt: now.toISOString() }
    : { status: 'refunded', updatedAt: now.toISOString() });
  await patchEntries(db, [data.patientUid, data.nutritionistId], data.appointmentId, { status: kind, value: data.value });
  return true;
}

interface FinanceTotals { count: number; gross: number; nutritionist: number; commission: number }

/** Painel "Financeiro" da nutricionista: configuração, cobranças e o que já recebeu (no mês e no total). */
export async function nutritionistFinance(db: Firestore, uid: string, now = new Date()) {
  const settings = await loadPaymentSettings(db, uid);
  const snap = await db.collection(PAYMENTS).where('nutritionistId', '==', uid).get();
  const monthKey = todayInBrasilia(now).slice(0, 7);
  const month: FinanceTotals = { count: 0, gross: 0, nutritionist: 0, commission: 0 };
  const total: FinanceTotals = { count: 0, gross: 0, nutritionist: 0, commission: 0 };
  const add = (sum: FinanceTotals, gross: number, shares: { nutritionist: number; commission: number }) => {
    sum.count += 1;
    sum.gross = Math.round((sum.gross + gross) * 100) / 100;
    sum.nutritionist = Math.round((sum.nutritionist + shares.nutritionist) * 100) / 100;
    sum.commission = Math.round((sum.commission + shares.commission) * 100) / 100;
  };
  const payments = snap.docs.map((doc) => {
    const data = doc.data() || {};
    const value = typeof data.value === 'number' ? data.value : 0;
    // Com o valor líquido do Asaas (sem a taxa dele), a divisão é exata; antes disso, é a estimativa sobre o valor cheio.
    const shares = splitValue(typeof data.netValue === 'number' ? data.netValue : value);
    if (data.status === 'paid') {
      add(total, value, shares);
      if (typeof data.paidAt === 'string' && todayInBrasilia(new Date(data.paidAt)).slice(0, 7) === monthKey) add(month, value, shares);
    }
    return {
      id: doc.id, patientName: String(data.patientName || ''), appointmentDate: String(data.appointmentDate || ''),
      appointmentTime: String(data.appointmentTime || ''), value, status: String(data.status || ''),
      paidAt: typeof data.paidAt === 'string' ? data.paidAt : null, createdAt: String(data.createdAt || ''),
      nutritionistAmount: shares.nutritionist, commission: shares.commission, exact: typeof data.netValue === 'number',
    };
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
  return {
    price: settings.consultationPrice, enabled: paymentsEnabled(settings),
    walletLinked: settings.walletId !== null, subaccount: settings.subaccountId !== null,
    month, total, payments,
  };
}
