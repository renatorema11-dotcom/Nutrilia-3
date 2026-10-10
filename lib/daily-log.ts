// Água e humor do dia do paciente: as mesmas regras na tela e na Ali (sem segredos; roda no navegador e no servidor).
import { localDateKey } from './agenda';

const DAILY_TIMEZONE = 'America/Sao_Paulo';

export const WATER_GOAL_ML = 2000;
/** O que cabe em um dia; a tela sempre limitou em três vezes a meta. */
export const WATER_MAX_ML = WATER_GOAL_ML * 3;

export const MOOD_LABELS = { sad: 'triste', neutral: 'neutro', happy: 'feliz', great: 'ótimo' } as const;
export type Mood = keyof typeof MOOD_LABELS;

export function isMood(value: unknown): value is Mood {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MOOD_LABELS, value);
}

/** "2026-10-12": o dia de hoje no horário de Brasília, igual na tela e no servidor. */
export function dailyKey(now: Date = new Date()): string {
  return localDateKey(now, DAILY_TIMEZONE);
}

/**
 * Confere se um registro guardado é de hoje. A tela antiga gravava a data no formato do navegador
 * ("12/10/2026"); quem chama da tela passa esse formato em `legacy` para não perder o que já foi marcado.
 */
export function isSameDay(stored: unknown, now: Date = new Date(), legacy?: string): boolean {
  if (typeof stored !== 'string' || !stored) return false;
  const key = dailyKey(now);
  const [year, month, day] = key.split('-');
  return stored === key || stored === `${day}/${month}/${year}` || (!!legacy && stored === legacy);
}

/** Água de hoje a partir do que está guardado (0 se o registro for de outro dia). */
export function waterToday(stored: unknown, now: Date = new Date(), legacy?: string): number {
  const record = stored && typeof stored === 'object' ? stored as { amount?: unknown; date?: unknown } : {};
  return isSameDay(record.date, now, legacy) && typeof record.amount === 'number' && record.amount > 0 ? Math.min(Math.round(record.amount), WATER_MAX_ML) : 0;
}

/** Humor de hoje, ou null se ainda não foi marcado. */
export function moodToday(stored: unknown, now: Date = new Date(), legacy?: string): Mood | null {
  const record = stored && typeof stored === 'object' ? stored as { mood?: unknown; date?: unknown } : {};
  return isSameDay(record.date, now, legacy) && isMood(record.mood) ? record.mood : null;
}
