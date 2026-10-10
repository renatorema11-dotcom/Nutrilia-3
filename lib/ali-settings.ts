// Configurações da Ali de cada nutricionista (sem segredos: pode ser usado no navegador e no servidor).

export type ConsultationMode = 'online' | 'presencial' | 'ambos';

export interface AliSettings {
  /** Nome com que a Ali apresenta a nutricionista, ex.: "Dra. Carla Mendes". */
  displayName: string;
  /** Dias de atendimento (0 = domingo ... 6 = sábado). */
  workDays: number[];
  /** Início e fim do atendimento, "HH:MM". */
  startTime: string;
  endTime: string;
  durationMinutes: number;
  /** Intervalo livre entre uma consulta e a próxima. */
  intervalMinutes: number;
  /** Antecedência mínima para a Ali marcar, em horas. */
  minNoticeHours: number;
  /** Até quantos dias à frente a Ali oferece horários. */
  horizonDays: number;
  mode: ConsultationMode;
  clinicName: string;
  address: string;
  price: string;
  contact: string;
  /** Orientações da nutricionista para a Ali (abordagem, lembretes). */
  guidelines: string;
  timezone: string;
}

export const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export const ALI_LIMITS = { name: 80, clinic: 120, address: 200, price: 60, contact: 120, guidelines: 800 };

export function defaultAliSettings(displayName = ''): AliSettings {
  return {
    displayName,
    workDays: [1, 2, 3, 4, 5],
    startTime: '08:00',
    endTime: '18:00',
    durationMinutes: 50,
    intervalMinutes: 10,
    minNoticeHours: 12,
    horizonDays: 21,
    mode: 'online',
    clinicName: '',
    address: '',
    price: '',
    contact: '',
    guidelines: '',
    timezone: 'America/Sao_Paulo',
  };
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function timeToMinutes(value: string): number {
  const m = TIME_RE.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

/** Texto livre seguro: sem quebras exageradas, sem chaves de variável da ElevenLabs e com limite de tamanho. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

function intInRange(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

/** Valida tudo o que chega do formulário; o que for inválido volta ao padrão. */
export function sanitizeAliSettings(input: unknown, base: AliSettings = defaultAliSettings()): AliSettings {
  const raw = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const workDays = Array.isArray(raw.workDays)
    ? [...new Set(raw.workDays.filter((d): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6))].sort((a, b) => a - b)
    : base.workDays;
  let startTime = typeof raw.startTime === 'string' && TIME_RE.test(raw.startTime) ? raw.startTime : base.startTime;
  let endTime = typeof raw.endTime === 'string' && TIME_RE.test(raw.endTime) ? raw.endTime : base.endTime;
  if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
    startTime = base.startTime;
    endTime = base.endTime;
  }
  const mode: ConsultationMode = raw.mode === 'presencial' || raw.mode === 'ambos' || raw.mode === 'online' ? raw.mode : base.mode;
  return {
    displayName: raw.displayName === undefined ? base.displayName : cleanText(raw.displayName, ALI_LIMITS.name),
    workDays: workDays.length ? workDays : base.workDays,
    startTime,
    endTime,
    durationMinutes: intInRange(raw.durationMinutes, 15, 180, base.durationMinutes),
    intervalMinutes: intInRange(raw.intervalMinutes, 0, 60, base.intervalMinutes),
    minNoticeHours: intInRange(raw.minNoticeHours, 0, 168, base.minNoticeHours),
    horizonDays: intInRange(raw.horizonDays, 1, 60, base.horizonDays),
    mode,
    clinicName: raw.clinicName === undefined ? base.clinicName : cleanText(raw.clinicName, ALI_LIMITS.clinic),
    address: raw.address === undefined ? base.address : cleanText(raw.address, ALI_LIMITS.address),
    price: raw.price === undefined ? base.price : cleanText(raw.price, ALI_LIMITS.price),
    contact: raw.contact === undefined ? base.contact : cleanText(raw.contact, ALI_LIMITS.contact),
    guidelines: raw.guidelines === undefined ? base.guidelines : cleanText(raw.guidelines, ALI_LIMITS.guidelines),
    // Fuso fixo por enquanto: todo o atendimento do NutriAli é no horário de Brasília.
    timezone: 'America/Sao_Paulo',
  };
}

function joinPt(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

/** "segunda a sexta" quando os dias são seguidos; senão lista os dias. */
export function describeWorkDays(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  const consecutive = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (sorted.length >= 3 && consecutive) return `${WEEKDAY_NAMES[sorted[0]]} a ${WEEKDAY_NAMES[sorted[sorted.length - 1]]}`;
  return joinPt(sorted.map((d) => WEEKDAY_NAMES[d]));
}

export function describeMode(mode: ConsultationMode): string {
  return mode === 'online' ? 'online, pelo Google Meet' : mode === 'presencial' ? 'presencial' : 'online (Google Meet) ou presencial';
}

/** Resumo do atendimento lido pela Ali. */
export function describeAttendance(s: AliSettings): string {
  return `${describeWorkDays(s.workDays)}, das ${s.startTime} às ${s.endTime}, consultas de ${s.durationMinutes} minutos, ${describeMode(s.mode)}`;
}

/** Dados do consultório em uma frase; vazio quando nada foi preenchido. */
export function describeClinic(s: AliSettings): string {
  const parts = [
    s.clinicName && `Consultório: ${s.clinicName}`,
    s.mode !== 'online' && s.address && `Endereço: ${s.address}`,
    s.price && `Valor da consulta: ${s.price}`,
    s.contact && `Contato: ${s.contact}`,
  ].filter(Boolean) as string[];
  return parts.join('. ');
}
