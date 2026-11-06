// NutriAli Premium, o plano pago do paciente. Fica no Premium o que é extra: a foto do prato analisada pela IA,
// os gráficos de evolução e as conquistas e a exportação do plano. O que a nutricionista prescreveu (plano, chat,
// consultas), a Ali e o "Baixar meus dados" (direito do paciente pela LGPD) são sempre grátis.
// Sem importações: as telas e o servidor usam as mesmas regras.

export const PREMIUM_PRICE = 19.9;
export const PREMIUM_PRICE_LABEL = 'R$ 19,90';
/** Dias de tolerância depois do mês pago, para o Pix ou o boleto do mês seguinte compensarem. */
export const PREMIUM_GRACE_DAYS = 3;

export type PremiumFeature = 'meal-photo' | 'charts' | 'export';

export const PREMIUM_FEATURES: { id: PremiumFeature; title: string; text: string }[] = [
  { id: 'meal-photo', title: 'Foto do prato com IA', text: 'Fotografe a refeição e receba as calorias e as porções calculadas pela IA e pela tabela TACO.' },
  { id: 'charts', title: 'Gráficos e conquistas', text: 'Acompanhe a evolução do peso e da gordura em gráficos e as conquistas de cada dia.' },
  { id: 'export', title: 'Plano em PDF', text: 'Baixe o seu plano alimentar e os cardápios criativos em PDF para imprimir ou compartilhar.' },
];

/** O que continua grátis, para a tela do Premium deixar claro que ninguém perde o acompanhamento. */
export const FREE_FEATURES = [
  'Plano alimentar da sua nutricionista',
  'Chat com a nutricionista e consultas',
  'A Ali, sua assistente por voz e por texto',
  'Diário de refeições, água e humor',
];

export const PREMIUM_REQUIRED_MESSAGE = 'Esta função é do NutriAli Premium. Assine em "Premium" no menu para liberar.';

/** Premium vale enquanto o mês pago ou a cortesia dada pelo responsável estiverem no prazo. */
export function isPremiumActive(premium: unknown, now = Date.now()): boolean {
  if (!premium || typeof premium !== 'object') return false;
  const state = premium as Record<string, unknown>;
  return [state.paidUntil, state.courtesyUntil].some((value) => typeof value === 'string' && Date.parse(value) > now);
}

/** Até quando o Premium vale (o mais longo entre o mês pago e a cortesia), ou null. */
export function premiumUntil(premium: unknown): Date | null {
  if (!premium || typeof premium !== 'object') return null;
  const state = premium as Record<string, unknown>;
  const times = [state.paidUntil, state.courtesyUntil]
    .map((value) => (typeof value === 'string' ? Date.parse(value) : NaN))
    .filter((time) => Number.isFinite(time));
  return times.length ? new Date(Math.max(...times)) : null;
}

/**
 * Novo prazo depois de um pagamento confirmado: um mês a partir do vencimento pago (ou de agora, se o vencimento
 * já passou), mais a tolerância. Nunca encurta um prazo maior que já exista (eventos repetidos ou fora de ordem).
 */
export function extendPaidUntil(current: unknown, dueDate: unknown, now = new Date()): string {
  const due = typeof dueDate === 'string' ? Date.parse(`${dueDate.slice(0, 10)}T12:00:00-03:00`) : NaN;
  const start = new Date(Math.max(now.getTime(), Number.isFinite(due) ? due : 0));
  const until = new Date(start);
  until.setUTCMonth(until.getUTCMonth() + 1);
  until.setUTCDate(until.getUTCDate() + PREMIUM_GRACE_DAYS);
  const previous = typeof current === 'string' ? Date.parse(current) : NaN;
  return Number.isFinite(previous) && previous > until.getTime() ? new Date(previous).toISOString() : until.toISOString();
}

/** CPF só com os números, se os dígitos verificadores baterem; senão, null. O Asaas exige o CPF de quem paga. */
export function validCpf(value: unknown): string | null {
  const digits = typeof value === 'string' ? value.replace(/\D/g, '') : '';
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return null;
  const check = (length: number) => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(digits[i]) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]) ? digits : null;
}
