// Nomes de exibição. Muitas nutricionistas se cadastram com o título ("Dra. Carla Mendes"):
// o título não serve de inicial do avatar nem de primeiro nome ("Conversar com Dra.").

const NAME_TITLES = new Set(['dr', 'dra', 'nutri', 'nutricionista', 'prof', 'profa', 'sr', 'sra']);

/** Palavras do nome sem os títulos do começo (o último nome fica, mesmo que pareça título). */
function nameWords(name: string): string[] {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  let start = 0;
  while (start < words.length - 1 && NAME_TITLES.has(words[start].toLowerCase().replace(/\.$/, ''))) start++;
  return words.slice(start);
}

/** Primeiro nome de verdade: "Dra. Carla Mendes" → "Carla". */
export function firstName(name: string): string {
  return nameWords(name)[0] || '';
}

/** Letra do avatar: "Dra. Carla Mendes" → "C". */
export function nameInitial(name: string): string {
  return firstName(name).charAt(0).toUpperCase();
}
