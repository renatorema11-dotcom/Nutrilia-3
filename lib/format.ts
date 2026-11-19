// Números e datas como se escreve no Brasil, iguais em todas as telas.

/** Peso sempre com uma casa: "80,0". */
export function formatKg(value: unknown): string {
  return Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Peso sem casa quando é inteiro: "80", "72,5". */
export function formatKgShort(value: unknown): string {
  return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}

/** "2026-10-30" vira "30/10/2026"; o que não for data segue como está. */
export function formatDayKey(value: unknown): string {
  const text = typeof value === 'string' ? value : '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : text;
}

/** A data de hoje no aparelho, no formato dos campos de data: à noite no Brasil, o horário UTC já é amanhã. */
export function localDayKey(now: Date = new Date()): string {
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
