// Política de Privacidade do NutriAli: versão em vigor, responsável e contato. Sem segredos: roda no navegador e no servidor.
// Mudou o texto da política em /privacidade? Troque a versão: todo mundo vê o termo de novo e aceita a versão nova.
export const PRIVACY_VERSION = '2026-10-29';
export const PRIVACY_VERSION_LABEL = '29 de outubro de 2026';
export const PRIVACY_CONTROLLER = 'NutriAli';
export const PRIVACY_CONTACT = 'nutriali44@gmail.com';

/** Aceite gravado no perfil (users/{uid}.privacyConsent). */
export interface PrivacyConsent { version: string; acceptedAt: string }

export function newConsent(now = new Date()): PrivacyConsent {
  return { version: PRIVACY_VERSION, acceptedAt: now.toISOString() };
}

/** A conta já aceitou a versão em vigor? */
export function hasCurrentConsent(profile: unknown): boolean {
  const consent = profile && typeof profile === 'object' ? (profile as { privacyConsent?: unknown }).privacyConsent : null;
  if (!consent || typeof consent !== 'object') return false;
  const { version, acceptedAt } = consent as Record<string, unknown>;
  return version === PRIVACY_VERSION && typeof acceptedAt === 'string';
}
