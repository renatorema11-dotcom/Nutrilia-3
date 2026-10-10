// Cálculo de horários livres para consultas (sem dependências; testado em tests/agenda.cjs).
import type { AliSettings } from './ali-settings';

export interface Interval { start: Date; end: Date }
export interface Slot { start: string; end: string; label: string }
export type Period = 'manha' | 'tarde' | 'noite';

const DAY_MS = 86_400_000;

interface ZonedParts { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Data e hora "de parede" de um instante no fuso informado. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return {
    year: Number(get('year')), month: Number(get('month')), day: Number(get('day')),
    hour: Number(get('hour')), minute: Number(get('minute')), weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

/** Diferença do fuso em relação ao UTC, em minutos (ex.: -180 em Brasília). */
export function offsetMinutes(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(date.getTime() / 60_000) * 60_000) / 60_000);
}

/** Instante correspondente a uma data/hora de parede no fuso informado. */
export function zonedToDate(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let result = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  result = guess - offsetMinutes(new Date(result), timeZone) * 60_000;
  return new Date(result);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-10-14T14:00:00-03:00": formato que a Ali repete ao escolher o horário. */
export function toOffsetIso(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  const off = offsetMinutes(date, timeZone);
  const sign = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** "terça-feira, 14 de outubro, às 14:00" */
export function slotLabel(date: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(date);
  const time = new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  return `${day}, às ${time}`;
}

function minutesOf(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

function overlaps(start: Date, end: Date, busy: Interval[], paddingMs: number): boolean {
  return busy.some((b) => start.getTime() < b.end.getTime() + paddingMs && b.start.getTime() < end.getTime() + paddingMs);
}

function inPeriod(hour: number, period?: Period): boolean {
  if (!period) return true;
  if (period === 'manha') return hour < 12;
  if (period === 'tarde') return hour >= 12 && hour < 18;
  return hour >= 18;
}

/** Janela que precisa ser consultada na agenda (de agora até o fim do horizonte). */
export function searchWindow(settings: AliSettings, now: Date): Interval {
  return { start: now, end: new Date(now.getTime() + (settings.horizonDays + 1) * DAY_MS) };
}

/**
 * Horários livres dentro do atendimento da nutricionista. Os inícios seguem uma grade
 * (duração + intervalo) a partir do horário de início do dia.
 */
export function generateSlots(
  settings: AliSettings,
  busy: Interval[],
  now: Date,
  options: { date?: string; period?: Period; max?: number; perDay?: number } = {},
): Slot[] {
  const tz = settings.timezone;
  const step = settings.durationMinutes + settings.intervalMinutes;
  const startMin = minutesOf(settings.startTime);
  const endMin = minutesOf(settings.endTime);
  const earliest = now.getTime() + settings.minNoticeHours * 3_600_000;
  const max = options.max ?? 6;
  const perDay = options.date ? max : options.perDay ?? 2;
  const padding = settings.intervalMinutes * 60_000;
  const today = zonedParts(now, tz);
  const anchor = zonedToDate(today.year, today.month, today.day, 12, 0, tz).getTime();
  const slots: Slot[] = [];

  for (let offset = 0; offset <= settings.horizonDays && slots.length < max; offset++) {
    const day = zonedParts(new Date(anchor + offset * DAY_MS), tz);
    const dateKey = `${day.year}-${pad(day.month)}-${pad(day.day)}`;
    if (options.date && options.date !== dateKey) continue;
    if (!settings.workDays.includes(day.weekday)) continue;
    let usedToday = 0;
    for (let m = startMin; m + settings.durationMinutes <= endMin && usedToday < perDay && slots.length < max; m += step) {
      const start = zonedToDate(day.year, day.month, day.day, Math.floor(m / 60), m % 60, tz);
      const end = new Date(start.getTime() + settings.durationMinutes * 60_000);
      if (start.getTime() < earliest) continue;
      if (!inPeriod(Math.floor(m / 60), options.period)) continue;
      if (overlaps(start, end, busy, padding)) continue;
      slots.push({ start: toOffsetIso(start, tz), end: toOffsetIso(end, tz), label: slotLabel(start, tz) });
      usedToday++;
    }
  }
  return slots;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::00(?:\.000)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Confere se o horário escolhido é um início válido da grade da nutricionista (sem consultar a agenda). */
export function validateSlotStart(settings: AliSettings, value: string, now: Date): { start: Date; end: Date } | { error: string } {
  if (typeof value !== 'string' || !ISO_RE.test(value.trim())) return { error: 'Horário em formato inválido.' };
  const start = new Date(value.trim());
  if (Number.isNaN(start.getTime())) return { error: 'Horário em formato inválido.' };
  const tz = settings.timezone;
  const p = zonedParts(start, tz);
  const minute = p.hour * 60 + p.minute;
  const startMin = minutesOf(settings.startTime);
  const step = settings.durationMinutes + settings.intervalMinutes;
  if (!settings.workDays.includes(p.weekday)) return { error: 'A nutricionista não atende nesse dia.' };
  if (minute < startMin || minute + settings.durationMinutes > minutesOf(settings.endTime) || (minute - startMin) % step !== 0) {
    return { error: 'Esse horário não está na agenda de atendimento.' };
  }
  if (start.getTime() < now.getTime() + settings.minNoticeHours * 3_600_000) return { error: 'Esse horário está muito próximo.' };
  if (start.getTime() > now.getTime() + (settings.horizonDays + 1) * DAY_MS) return { error: 'Esse horário está longe demais.' };
  return { start, end: new Date(start.getTime() + settings.durationMinutes * 60_000) };
}

export function isFree(start: Date, end: Date, busy: Interval[], intervalMinutes: number): boolean {
  return !overlaps(start, end, busy, intervalMinutes * 60_000);
}
