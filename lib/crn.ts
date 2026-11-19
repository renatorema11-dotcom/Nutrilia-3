// CRN informado no cadastro da nutricionista: região (CRN-1 a CRN-11) e número de inscrição.
// Aqui só se confere o formato. Se a inscrição existe e está ativa, quem confere é uma pessoa, na consulta pública do
// Conselho Federal de Nutrição: ela não oferece acesso automático (tem conferência contra robôs) e não é contornada.
// Sem segredos: roda no navegador e no servidor.

export const CRN_REGIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/** Consulta Nacional de Nutricionistas (CFN): busca por nome ou inscrição, com a situação do registro. */
export const CFN_LOOKUP_URL = 'https://cnn.cfn.org.br/application/index/consulta-nacional';

export type CrnCheck = { ok: true; crn: string; region: number; number: string } | { ok: false; error: string };

const CRN_FORMAT = /^(?:CRN)?[\s\-\/.ºª°]*(\d{1,2})[\s\-\/]+(\d{2,7})(?:\s*[\/\-]?\s*([A-Z]))?$/;

/**
 * Lê um CRN escrito à mão ("CRN-3 12345", "crn3/12.345", "3 12345/P") e devolve no formato único "CRN-3 12345".
 * A letra no fim (como /P, de inscrição provisória) é mantida.
 */
export function parseCrn(input: unknown): CrnCheck {
  const text = typeof input === 'string' ? input.trim().toUpperCase().replace(/(\d)\.(?=\d)/g, '$1') : '';
  if (!text) return { ok: false, error: 'Informe o seu CRN.' };
  const match = CRN_FORMAT.exec(text);
  if (!match) return { ok: false, error: 'Escreva o CRN com a região e o número, por exemplo: CRN-3 12345.' };
  const region = Number(match[1]);
  if (!CRN_REGIONS.includes(region)) return { ok: false, error: 'A região do CRN vai de 1 a 11.' };
  const number = match[2] + (match[3] ? `/${match[3]}` : '');
  return { ok: true, crn: `CRN-${region} ${number}`, region, number };
}
