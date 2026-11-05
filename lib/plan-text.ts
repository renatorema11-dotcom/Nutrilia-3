// O plano na tela do paciente: limpa o texto do cardápio criativo da IA, acha as refeições nele e escolhe as de hoje.
// Sem segredos: roda no navegador.
import { dailyKey } from './daily-log';

export interface PlanMeal {
  id: string;
  name: string;
  time?: string;
  items: string[];
}

interface PlanDay {
  name?: unknown;
  meals?: unknown;
}

// \b não enxerga letra acentuada ("café"): as pontas da palavra são conferidas à mão.
const MEAL_WORDS = /(?<!\p{L})(caf[eé]|desjejum|almo[cç]o|lanche|jantar|janta|ceia|cola[cç][aã]o|merenda|refei[cç][aã]o|pr[eé][\s\-‑–]*treino|p[oó]s[\s\-‑–]*treino)(?!\p{L})/iu;
const NOT_A_MEAL = /(?<!\p{L})(dicas?|observa[cç][oõ]es|orienta[cç][oõ]es|total|resumo|lista de compras|plano)(?!\p{L})/iu;
const TIME = /\(?\b(\d{1,2}[:h]\d{2}|\d{1,2}h)\b\)?/i;
const BULLET = /^\s*[-‑–—•*]\s+/;
const LINE_BREAK = /<br\s*\/?>/gi;

const clean = (text: string) => text.replace(/\*\*/g, '').replace(/\\\*/g, '*').replace(LINE_BREAK, ' ').replace(/\s+/g, ' ').trim();

/** Tira emoji e pontuação das pontas de um título ("🟢 Almoço:" vira "Almoço"). */
const cleanTitle = (text: string) => clean(text)
  .replace(/\p{Extended_Pictographic}|️/gu, '')
  .replace(/\(\s*\)/g, '')
  .replace(/^[\s\-‑–—:.]+|[\s\-‑–—:.]+$/g, '')
  .trim();

const tableCells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
const isTableLine = (line: string) => line.trim().startsWith('|') && line.trim().length > 1;
const isSeparator = (cells: string[]) => cells.every((cell) => /^:?-{2,}:?$/.test(cell));

/** Uma tabela vira um título por refeição, com os alimentos em lista: a tela não desenha tabelas. */
function tableToMarkdown(lines: string[]): string {
  const rows = lines.map(tableCells).filter((cells) => !isSeparator(cells));
  if (rows.length < 2) return rows.map((cells) => cells.map(clean).filter(Boolean).join(' · ')).join('\n');
  const header = rows[0].map((cell) => clean(cell).toLowerCase());
  const column = (pattern: RegExp) => header.findIndex((cell) => pattern.test(cell));
  const timeAt = column(/hor[aá]rio|hora/);
  const mealAt = column(/refei|momento/);
  const dishAt = column(/prato|card[aá]pio|alimento|o que|descri|menu|op[cç][aã]o/);
  const portionAt = column(/por[cç]|quantidade/);
  const macrosAt = column(/macro|calor|kcal/);
  if (mealAt < 0 || dishAt < 0) return rows.map((cells) => `- ${cells.map(clean).filter(Boolean).join(' · ')}`).join('\n');

  return rows.slice(1).map((cells) => {
    const time = timeAt >= 0 ? clean(cells[timeAt] || '') : '';
    const title = `## ${clean(cells[mealAt] || '')}${time ? ` (${time})` : ''}`;
    const dish = (cells[dishAt] || '').split(LINE_BREAK).map((part) => part.trim()).filter(Boolean);
    const portion = portionAt >= 0 ? clean(cells[portionAt] || '') : '';
    const macros = macrosAt >= 0 ? clean(cells[macrosAt] || '') : '';
    const items = [
      ...dish.map((part) => `- ${clean(part.replace(BULLET, ''))}`),
      ...(portion ? [`- Porção: ${portion}`] : []),
      ...(macros ? [`- Macronutrientes: ${macros}`] : []),
    ];
    return [title, ...items].join('\n');
  }).join('\n\n');
}

/** Deixa o texto da IA pronto para a tela: sem tabela, sem HTML e sem caractere quebrado. */
export function planTextToMarkdown(text: unknown): string {
  if (typeof text !== 'string') return '';
  const lines = text.replace(/\r\n/g, '\n').replace(/�/g, '').split('\n');
  const output: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isTableLine(lines[i])) {
      output.push(lines[i].replace(LINE_BREAK, '\n'));
      continue;
    }
    const start = i;
    while (i + 1 < lines.length && isTableLine(lines[i + 1])) i++;
    output.push(tableToMarkdown(lines.slice(start, i + 1)));
  }
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Se a linha abre uma refeição, devolve o nome, o horário e o que veio depois dos dois-pontos. */
function mealHeading(line: string): { name: string; time?: string; rest: string } | null {
  const isTitle = /^#{1,6}\s+/.test(line) || /^(\d+\.\s*)?\*\*[^*]+\*\*\s*:?\s*$/.test(line);
  const bare = line.replace(/^#{1,6}\s+/, '').replace(BULLET, '').replace(/^\d+\.\s*/, '');
  // "**Almoço (12:30):** arroz e feijão" ou "Almoço: arroz e feijão": o que vem depois são os alimentos.
  const split = /^(\*\*[^*]+\*\*|[^:*]{2,60}):\s*(.*)$/.exec(bare.replace(/(\d{1,2}):(\d{2})/g, '$1h$2'));
  const rawName = isTitle ? bare : split ? split[1] : '';
  const rest = !isTitle && split ? split[2].replace(/(\d{1,2})h(\d{2})/g, '$1:$2') : '';
  if (!rawName) return null;
  const title = cleanTitle(rawName);
  if (!MEAL_WORDS.test(title) || NOT_A_MEAL.test(title) || title.length > 70) return null;
  const match = TIME.exec(title);
  const name = cleanTitle(title.replace(TIME, ''));
  return name ? { name, time: match ? match[1].replace('h', ':').replace(/:$/, ':00') : undefined, rest } : null;
}

/** As refeições escritas num texto de plano. Títulos que não são refeição (dicas, totais) não contam. */
export function mealsFromPlanText(text: unknown): PlanMeal[] {
  const meals: PlanMeal[] = [];
  let current: PlanMeal | null = null;
  for (const raw of planTextToMarkdown(text).split('\n')) {
    const line = raw.trim();
    if (!line || /^-{3,}$/.test(line)) continue;
    const heading = mealHeading(line);
    if (heading) {
      current = { id: `meal_${meals.length}`, name: heading.name, time: heading.time, items: heading.rest ? [clean(heading.rest)] : [] };
      meals.push(current);
    } else if (/^#{1,6}\s+/.test(line) || /^\*\*[^*]+\*\*\s*:?\s*$/.test(line)) {
      // Outro título (dicas, por exemplo): o que vem depois não é desta refeição.
      current = null;
    } else if (current) {
      current.items.push(clean(line.replace(BULLET, '')));
    }
  }
  return meals;
}

const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const plainText = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Dias da semana (0 = domingo) que o nome de um grupo do plano cobre; vazio quando o nome não diz. */
export function weekdaysOfDayName(name: unknown): number[] {
  const text = plainText(typeof name === 'string' ? name : '');
  const days = new Set<number>();
  if (/(fim|final) de semana/.test(text)) { days.add(0); days.add(6); }
  if (/dias? ute(is|l)/.test(text)) [1, 2, 3, 4, 5].forEach((day) => days.add(day));
  const range = /(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira)?\s*(?:a|ate|-)\s*(domingo|segunda|terca|quarta|quinta|sexta|sabado)/.exec(text);
  if (range) {
    const end = WEEKDAYS.indexOf(range[2]);
    for (let day = WEEKDAYS.indexOf(range[1]); ; day = (day + 1) % 7) {
      days.add(day);
      if (day === end) break;
    }
  }
  WEEKDAYS.forEach((day, index) => { if (text.includes(day)) days.add(index); });
  return [...days];
}

/** O grupo de dias do plano que vale hoje em Brasília ("Fim de Semana" no sábado); sem pista no nome, o primeiro. */
export function planDayIndexForToday(days: PlanDay[], now: Date = new Date()): number {
  const today = new Date(`${dailyKey(now)}T12:00:00Z`).getUTCDay();
  const index = days.findIndex((day) => weekdaysOfDayName(day?.name).includes(today));
  return index >= 0 ? index : 0;
}

const mealsOfDay = (day: PlanDay | undefined): PlanMeal[] => (Array.isArray(day?.meals) ? day.meals : [])
  .filter((meal: any) => meal && typeof meal.name === 'string')
  .map((meal: any, index: number) => ({
    id: `meal_${index}`,
    name: meal.name,
    time: typeof meal.time === 'string' ? meal.time : undefined,
    items: Array.isArray(meal.items) ? meal.items.filter((item: unknown) => typeof item === 'string') : [],
  }));

/** As refeições de um grupo de dias do plano prescrito. */
export function planDayMeals(day: PlanDay | undefined): PlanMeal[] {
  return mealsOfDay(day);
}

/**
 * As refeições de hoje de quem está usando o app: as do plano aprovado pela nutricionista;
 * sem ele, as do último cardápio criativo salvo.
 */
export function todayMealsOf(data: { currentPlan?: { days?: unknown } | null; savedPlans?: unknown } | null | undefined, now: Date = new Date()): PlanMeal[] {
  const days = Array.isArray(data?.currentPlan?.days) ? data.currentPlan.days as PlanDay[] : [];
  if (days.length) return mealsOfDay(days[planDayIndexForToday(days, now)]);
  const saved = Array.isArray(data?.savedPlans) ? data.savedPlans[0] : null;
  return saved && typeof saved === 'object' ? mealsFromPlanText((saved as { content?: unknown }).content) : [];
}

/** O plano prescrito em texto, para ler por inteiro e para o PDF. */
export function planDaysToMarkdown(days: unknown): string {
  return (Array.isArray(days) ? days as PlanDay[] : []).map((day) => {
    const meals = mealsOfDay(day).map((meal) => [
      `### ${meal.name}${meal.time ? ` (${meal.time})` : ''}`,
      ...meal.items.map((item) => `- ${item}`),
    ].join('\n'));
    return [typeof day?.name === 'string' && day.name ? `## ${day.name}` : '', ...meals].filter(Boolean).join('\n\n');
  }).join('\n\n');
}
