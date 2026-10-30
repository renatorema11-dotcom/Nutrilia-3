// Ligação com a API do Asaas, usada pelo Premium (lib/asaas.ts) e pelas consultas pagas (lib/consultation-payments.ts).
// A chave fica só no servidor (ASAAS_API_KEY). Sem ASAAS_ENV=production, tudo roda no ambiente de teste do Asaas.
import type { Firestore } from 'firebase-admin/firestore';

export type AsaasRequest = (path: string, init?: { method?: string; body?: unknown }) => Promise<any>;

export class AsaasError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const ASAAS_URLS = { sandbox: 'https://api-sandbox.asaas.com/v3', production: 'https://api.asaas.com/v3' };

export function asaasConfigured(): boolean {
  return !!process.env.ASAAS_API_KEY;
}

/** Chamada à API do Asaas. Erro do Asaas vira AsaasError com a descrição que ele devolveu. */
export const asaasRequest: AsaasRequest = async (path, init = {}) => {
  const key = process.env.ASAAS_API_KEY;
  if (!key) throw new AsaasError('O pagamento pelo app ainda está sendo configurado.', 503);
  const base = process.env.ASAAS_ENV === 'production' ? ASAAS_URLS.production : ASAAS_URLS.sandbox;
  const res = await fetch(base + path, {
    method: init.method || 'GET',
    // O Asaas exige User-Agent nas contas criadas a partir de junho de 2024.
    headers: { access_token: key, 'content-type': 'application/json', 'user-agent': 'NutriAli' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const description = data?.errors?.[0]?.description;
    throw new AsaasError(typeof description === 'string' ? description : `O Asaas respondeu ${res.status}.`, res.status);
  }
  return data;
};

/** Data em Brasília, no formato do Asaas (AAAA-MM-DD), hoje ou daqui a alguns dias. */
export function todayInBrasilia(now = new Date(), plusDays = 0): string {
  const date = new Date(now.getTime() + plusDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

type CustomerResult = { ok: true; customer: string } | { ok: false; status: number; error: string; needCpf: true };

/**
 * Cliente do paciente no Asaas: o mesmo para o Premium e para as consultas. Na primeira cobrança precisa do CPF,
 * que vai só para o Asaas; o NutriAli guarda apenas o código do cliente (billing/{uid}).
 */
export async function ensureCustomer(
  db: Firestore, uid: string, buyer: { name: string; email: string; cpf: string | null }, request: AsaasRequest, now: Date,
): Promise<CustomerResult> {
  const billingRef = db.collection('billing').doc(uid);
  const existing = (await billingRef.get()).data()?.asaasCustomerId;
  if (typeof existing === 'string' && existing) return { ok: true, customer: existing };
  if (!buyer.cpf) return { ok: false, status: 422, error: 'Informe um CPF válido: o Asaas pede o CPF de quem paga.', needCpf: true };
  const created = await request('/customers', {
    method: 'POST',
    body: { name: buyer.name.slice(0, 100), email: buyer.email, cpfCnpj: buyer.cpf, externalReference: uid },
  });
  if (typeof created?.id !== 'string') throw new AsaasError('O Asaas não devolveu o cliente.', 502);
  await billingRef.set({ asaasCustomerId: created.id, updatedAt: now.toISOString() }, { merge: true });
  return { ok: true, customer: created.id };
}
