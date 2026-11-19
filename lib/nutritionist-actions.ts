// Todas as ações da Ali da nutricionista em um lugar só. O webhook (/api/agent/nutritionist-action) e o servidor MCP
// (/api/mcp, o "segundo cérebro") usam esta mesma lista: o nome da ação, se ela só lê ou se grava/envia, o texto que
// explica ao modelo quando usar, os campos aceitos e a função que faz o trabalho. Somente no servidor.
// Regras que valem para todas: o uid vem sempre do login conferido pela rota (nunca do pedido), cada função só enxerga
// os dados dessa nutricionista, e ação que grava ou envia só roda com confirmed === true (o "sim" dela na conversa).
import type { Firestore } from 'firebase-admin/firestore';
import type { ActionResult } from './google-workspace';
import type { LastSeenLookup } from './weekly-report';
import type { PlanGenerator, RunLater } from './nutritionist-assistant';
import * as assistant from './nutritionist-assistant';
import * as memory from './ali-memory';
import * as clinical from './clinical-profile';
import * as timeline from './patient-timeline';
import * as foods from './food-tools';
import * as brain from './nutritionist-brain';
import { foodInfo } from './food-info';
import { localDateKey } from './agenda';
import { loadSettings } from './google-workspace';

/** O que cada ação recebe da rota: o banco, a nutricionista já conferida e as peças que dependem do servidor. */
export interface ActionContext {
  db: Firestore;
  uid: string;
  /** Último acesso dos pacientes ao app (Firebase Auth). */
  lastSeen: LastSeenLookup;
  /** IA que monta o rascunho do plano (lib/plan-draft.ts). */
  generatePlan: PlanGenerator;
  /** Roda uma tarefa depois da resposta (o "after" do Next), para a voz não esperar a IA. */
  runLater: RunLater;
}

export type ActionParamType = 'string' | 'number' | 'integer' | 'boolean' | 'string[]';
export interface ActionParam { type: ActionParamType; description: string; options?: string[] }
type ActionPayload = Record<string, unknown>;

export interface ActionDef {
  name: string;
  /** 'read' só consulta; 'write' grava, marca ou envia algo e exige a confirmação da nutricionista. */
  kind: 'read' | 'write';
  /** Nome curto para telas e listas. */
  title: string;
  /** Explica ao modelo quando usar a ação (vai para a lista de ferramentas do MCP). */
  description: string;
  params: Record<string, ActionParam>;
  required: string[];
  /** Fala com serviços de fora do app (Agenda, Gmail ou Planilhas do Google da nutricionista). */
  external?: boolean;
  /** Repetir a mesma chamada não muda mais nada. */
  idempotent?: boolean;
  run: (ctx: ActionContext, payload: ActionPayload) => Promise<ActionResult> | ActionResult;
}

// ───────────── Campos que se repetem ─────────────

const PATIENT: ActionParam = { type: 'string', description: 'Nome do paciente, como a nutricionista falou.' };
const PATIENT_OPTIONAL: ActionParam = { type: 'string', description: 'Nome do paciente (opcional): quando vier, os dados que faltarem saem do prontuário dele.' };
const DATE: ActionParam = { type: 'string', description: 'Data no formato AAAA-MM-DD.' };
const TIME: ActionParam = { type: 'string', description: 'Hora no formato HH:MM, de 00:00 a 23:59.' };
const FORCE_BUSY: ActionParam = { type: 'boolean', description: 'true só quando ela mandou marcar mesmo já tendo outro compromisso no horário.' };
const WEIGHT: ActionParam = { type: 'number', description: 'Peso em quilos.' };
const HEIGHT: ActionParam = { type: 'number', description: 'Altura em centímetros.' };
const AGE: ActionParam = { type: 'integer', description: 'Idade em anos.' };
const GRAMS: ActionParam = { type: 'number', description: 'Quantidade em gramas (sem dizer, vale 100).' };

type PatientRef = { uid: string; name: string };

/** Acha o paciente pelo nome falado, na lista dela; nome que não aponta para uma pessoa só vira pergunta da Ali. */
async function withPatient(ctx: ActionContext, spoken: unknown, run: (patient: PatientRef) => Promise<ActionResult> | ActionResult): Promise<ActionResult> {
  const picked = await assistant.findPatient(ctx.db, ctx.uid, spoken);
  return picked.ok ? run(picked.value) : picked.result;
}

/** Paciente opcional: sem nome, a ação vale para a nutricionista em geral (ou só com os números que ela disser). */
async function withOptionalPatient(ctx: ActionContext, spoken: unknown, run: (patient: PatientRef | null) => Promise<ActionResult> | ActionResult): Promise<ActionResult> {
  if (typeof spoken !== 'string' || !spoken.trim()) return run(null);
  return withPatient(ctx, spoken, run);
}

async function zoneOf(ctx: ActionContext): Promise<string> {
  return (await loadSettings(ctx.db, ctx.uid)).timezone;
}

/** O dia de hoje (AAAA-MM-DD) no fuso da nutricionista: prazo de pendência não pode cair no passado. */
async function todayOf(ctx: ActionContext): Promise<string> {
  return localDateKey(new Date(), await zoneOf(ctx));
}

// ───────────── A lista ─────────────

export const NUTRITIONIST_ACTIONS: ActionDef[] = [
  // Pacientes e prontuário
  {
    name: 'list_patients', kind: 'read', title: 'Listar pacientes',
    description: 'Lista os pacientes da nutricionista ou procura um pelo nome.',
    params: { search: { type: 'string', description: 'Nome ou parte do nome (opcional).' } }, required: [],
    run: (ctx, p) => assistant.listPatients(ctx.db, ctx.uid, p.search),
  },
  {
    name: 'get_patient', kind: 'read', title: 'Dados do paciente',
    description: 'Resumo curto de um paciente: objetivo, peso, meta, plano e próxima consulta.',
    params: { patientName: PATIENT }, required: ['patientName'],
    run: (ctx, p) => assistant.patientSummary(ctx.db, ctx.uid, p.patientName),
  },
  {
    name: 'get_consultation_brief', kind: 'read', title: 'Resumo antes da consulta',
    description: 'Resumo para ler antes da consulta: peso e meta, registros das últimas duas semanas, plano, pendências, alertas da ficha e a última anotação. Sem nome, usa a próxima consulta marcada.',
    params: { patientName: { type: 'string', description: 'Nome do paciente (opcional).' } }, required: [],
    run: (ctx, p) => assistant.consultationBrief(ctx.db, ctx.uid, p.patientName, ctx.lastSeen),
  },
  {
    name: 'get_attention_list', kind: 'read', title: 'Quem precisa de atenção',
    description: 'Pacientes que pedem atenção agora, do mais urgente ao menos urgente, com o motivo.',
    params: {}, required: [],
    run: (ctx) => assistant.attentionList(ctx.db, ctx.uid, ctx.lastSeen),
  },
  {
    name: 'get_week_summary', kind: 'read', title: 'Resumo da semana',
    description: 'Resumo da semana da nutricionista: consultas, registros dos pacientes e quem está parado.',
    params: {}, required: [],
    run: (ctx) => assistant.weekSummary(ctx.db, ctx.uid, ctx.lastSeen),
  },
  {
    name: 'get_patient_timeline', kind: 'read', title: 'Linha do tempo do paciente',
    description: 'Histórico do paciente em ordem de data: pesagens, consultas, anotações, planos e pedidos. Use para "como foi a evolução" ou "o que aconteceu desde tal mês".',
    params: { patientName: PATIENT, months: { type: 'integer', description: 'Quantos meses para trás, de 1 a 24 (sem dizer, vale 6).' } }, required: ['patientName'],
    run: (ctx, p) => withPatient(ctx, p.patientName, async (patient) => timeline.patientTimeline(ctx.db, ctx.uid, patient, { months: p.months }, await zoneOf(ctx))),
  },
  {
    name: 'log_measurement', kind: 'write', title: 'Anotar peso',
    description: 'Anota no prontuário o peso de hoje do paciente e, se ela disser, o percentual de gordura.',
    params: { patientName: PATIENT, weight: WEIGHT, bodyFat: { type: 'number', description: 'Percentual de gordura (opcional).' } }, required: ['patientName', 'weight'],
    run: (ctx, p) => assistant.logMeasurement(ctx.db, ctx.uid, p),
  },

  // Ficha clínica
  {
    name: 'get_clinical_profile', kind: 'read', title: 'Ler a ficha clínica',
    description: 'Lê a ficha clínica do paciente: alergias, intolerâncias, restrições, o que não gosta, preferências, condições de saúde, medicamentos, suplementos, sexo e nível de atividade.',
    params: { patientName: PATIENT }, required: ['patientName'],
    run: (ctx, p) => withPatient(ctx, p.patientName, (patient) => clinical.getClinicalProfile(ctx.db, ctx.uid, patient)),
  },
  {
    name: 'update_clinical_profile', kind: 'write', title: 'Atualizar a ficha clínica',
    description: 'Acrescenta ou tira um item da ficha clínica do paciente, ou define sexo, nível de atividade e observações. Uma chamada por campo.',
    params: {
      patientName: PATIENT,
      field: { type: 'string', description: 'Campo da ficha.', options: ['allergies', 'intolerances', 'restrictions', 'dislikes', 'preferences', 'conditions', 'medications', 'supplements', 'sex', 'activity', 'notes'] },
      add: { type: 'string[]', description: 'Itens para acrescentar (campos de lista).' },
      remove: { type: 'string', description: 'Item para tirar (campos de lista).' },
      value: { type: 'string', description: 'Valor para sex (F ou M), activity (sedentario, leve, moderado, intenso ou muito_intenso) ou notes (texto das observações).' },
    }, required: ['patientName', 'field'],
    run: (ctx, p) => withPatient(ctx, p.patientName, (patient) => clinical.updateClinicalProfile(ctx.db, ctx.uid, patient, p, 'ali')),
  },

  // Anotações de consulta
  {
    name: 'get_consultation_notes', kind: 'read', title: 'Ler anotações de consulta',
    description: 'Lê as últimas anotações de consulta que a nutricionista fez sobre o paciente.',
    params: { patientName: PATIENT }, required: ['patientName'],
    run: (ctx, p) => assistant.consultationNotes(ctx.db, ctx.uid, p.patientName),
  },
  {
    name: 'add_consultation_note', kind: 'write', title: 'Anotar a consulta',
    description: 'Salva uma anotação de consulta no prontuário do paciente. Só a nutricionista vê.',
    params: { patientName: PATIENT, text: { type: 'string', description: 'Texto da anotação, como ela ditou.' } }, required: ['patientName', 'text'],
    run: (ctx, p) => assistant.addConsultationNote(ctx.db, ctx.uid, p),
  },

  // Plano alimentar
  {
    name: 'create_plan_draft', kind: 'write', title: 'Montar rascunho de plano',
    description: 'Pede à IA um rascunho de plano alimentar para o paciente, com as orientações dela. A ficha clínica e as preferências de trabalho dela entram sozinhas. Fica pronto em cerca de um minuto e só vale depois que ela aprovar no app.',
    params: {
      patientName: PATIENT,
      text: { type: 'string', description: 'Orientações dela para o plano: calorias, número de refeições, o que evitar (opcional).' },
      force: { type: 'boolean', description: 'true só quando ela confirmou que quer um rascunho novo no lugar do que já espera aprovação.' },
    }, required: ['patientName'],
    run: (ctx, p) => assistant.createPlanDraft(ctx.db, ctx.uid, p, ctx.generatePlan, ctx.runLater),
  },
  {
    name: 'get_plan_draft', kind: 'read', title: 'Ler rascunho de plano',
    description: 'Lê o rascunho de plano que espera aprovação, ou diz se ainda está sendo montado.',
    params: { patientName: PATIENT }, required: ['patientName'],
    run: (ctx, p) => assistant.planDraft(ctx.db, ctx.uid, p.patientName),
  },
  {
    name: 'check_plan', kind: 'read', title: 'Conferir o plano',
    description: 'Confere o plano do paciente: calorias e macros por dia pela tabela TACO, proteína por quilo, diferença para a meta e itens que batem com alergias, intolerâncias e restrições da ficha. Sem dizer qual, confere o rascunho; sem rascunho, o plano aprovado.',
    params: {
      patientName: PATIENT,
      which: { type: 'string', description: 'Qual plano conferir (opcional).', options: ['draft', 'approved'] },
      targetKcal: { type: 'number', description: 'Meta de calorias por dia, para comparar (opcional).' },
    }, required: ['patientName'],
    run: (ctx, p) => withPatient(ctx, p.patientName, (patient) => brain.checkPlanFor(ctx.db, ctx.uid, patient, { which: p.which, targetKcal: p.targetKcal })),
  },
  {
    name: 'send_plan_email', kind: 'write', title: 'Enviar plano por e-mail', external: true,
    description: 'Envia o plano alimentar aprovado para o e-mail do paciente, pelo Gmail da nutricionista.',
    params: { patientName: PATIENT }, required: ['patientName'],
    run: (ctx, p) => assistant.sendPlanToPatient(ctx.db, ctx.uid, p.patientName),
  },

  // Agenda e consultas
  {
    name: 'get_agenda', kind: 'read', title: 'Ver a agenda', external: true,
    description: 'Compromissos da agenda do Google da nutricionista em um dia ou em até 7 dias seguidos.',
    params: { date: { type: 'string', description: 'Primeiro dia, AAAA-MM-DD (sem dizer, vale hoje).' }, days: { type: 'integer', description: 'Quantos dias, de 1 a 7 (sem dizer, vale 1).' } }, required: [],
    run: (ctx, p) => assistant.agenda(ctx.db, ctx.uid, { date: p.date, days: p.days }),
  },
  {
    name: 'schedule_consultation', kind: 'write', title: 'Marcar consulta', external: true,
    description: 'Marca uma consulta com um paciente dela na agenda do Google, com link do Meet quando for online, e avisa o paciente por e-mail.',
    params: {
      patientName: PATIENT, date: DATE, time: TIME,
      mode: { type: 'string', description: 'Tipo da consulta (opcional).', options: ['online', 'presencial'] },
      notes: { type: 'string', description: 'Observação para a consulta (opcional).' },
      force: FORCE_BUSY,
    }, required: ['patientName', 'date', 'time'],
    run: (ctx, p) => assistant.scheduleConsultation(ctx.db, ctx.uid, p),
  },
  {
    name: 'reschedule_consultation', kind: 'write', title: 'Remarcar consulta', external: true,
    description: 'Troca o dia e a hora da próxima consulta marcada do paciente e avisa o paciente.',
    params: { patientName: PATIENT, date: DATE, time: TIME, force: FORCE_BUSY }, required: ['patientName', 'date', 'time'],
    run: (ctx, p) => assistant.rescheduleConsultation(ctx.db, ctx.uid, p),
  },
  {
    name: 'cancel_consultation', kind: 'write', title: 'Cancelar consulta', external: true,
    description: 'Cancela a próxima consulta marcada do paciente e avisa o paciente.',
    params: { patientName: PATIENT }, required: ['patientName'],
    run: (ctx, p) => assistant.cancelConsultation(ctx.db, ctx.uid, p.patientName),
  },
  {
    name: 'list_appointment_requests', kind: 'read', title: 'Pedidos de consulta',
    description: 'Pedidos de consulta que os pacientes fizeram e ainda esperam resposta.',
    params: {}, required: [],
    run: (ctx) => assistant.listAppointmentRequests(ctx.db, ctx.uid),
  },
  {
    name: 'decline_appointment_request', kind: 'write', title: 'Encerrar pedido de consulta',
    description: 'Encerra o pedido de consulta de um paciente sem marcar. Com texto, o recado vai para o chat dele.',
    params: { patientName: PATIENT, text: { type: 'string', description: 'Recado para o paciente (opcional).' } }, required: ['patientName'],
    run: (ctx, p) => assistant.declineAppointmentRequest(ctx.db, ctx.uid, p),
  },
  {
    name: 'create_event', kind: 'write', title: 'Criar compromisso', external: true,
    description: 'Cria um compromisso na agenda do Google que não é consulta de paciente: reunião, visita ou lembrete.',
    params: {
      title: { type: 'string', description: 'Título do compromisso.' }, date: DATE, time: TIME,
      durationMinutes: { type: 'integer', description: 'Duração em minutos, de 15 a 480 (sem dizer, vale 60).' },
      guest: { type: 'string', description: 'Convidado: nome de um paciente ou de um contato salvo (opcional).' },
      online: { type: 'boolean', description: 'true para criar link do Meet.' },
      notes: { type: 'string', description: 'Descrição (opcional).' },
      force: FORCE_BUSY,
    }, required: ['title', 'date', 'time'],
    run: (ctx, p) => assistant.createEvent(ctx.db, ctx.uid, p),
  },

  // Recados e e-mails
  {
    name: 'send_chat_message', kind: 'write', title: 'Recado no chat do paciente',
    description: 'Envia um recado da nutricionista para o chat do paciente no app.',
    params: { patientName: PATIENT, text: { type: 'string', description: 'Texto do recado.' } }, required: ['patientName', 'text'],
    run: (ctx, p) => assistant.sendChatMessage(ctx.db, ctx.uid, p),
  },
  {
    name: 'send_email', kind: 'write', title: 'Enviar e-mail', external: true,
    description: 'Envia um e-mail pelo Gmail da nutricionista. Só para pacientes dela e contatos salvos na Minha Ali.',
    params: {
      to: { type: 'string', description: 'Nome do paciente ou do contato salvo que vai receber.' },
      subject: { type: 'string', description: 'Assunto.' },
      body: { type: 'string', description: 'Texto do e-mail.' },
    }, required: ['to', 'subject', 'body'],
    run: (ctx, p) => assistant.sendEmail(ctx.db, ctx.uid, p),
  },
  {
    name: 'list_contacts', kind: 'read', title: 'Contatos salvos',
    description: 'Contatos que a nutricionista salvou na Minha Ali (laboratórios, colegas), para e-mails e convites.',
    params: {}, required: [],
    run: (ctx) => assistant.listContacts(ctx.db, ctx.uid),
  },
  {
    name: 'create_spreadsheet', kind: 'write', title: 'Criar planilha', external: true,
    description: 'Cria uma planilha no Google Planilhas da nutricionista e manda o link para o e-mail dela.',
    params: {
      sheet: { type: 'string', description: 'Qual planilha.', options: ['patients', 'weights', 'plan', 'agenda'] },
      patientName: { type: 'string', description: 'Nome do paciente (para weights e plan).' },
      draft: { type: 'boolean', description: 'true para usar o rascunho do plano em vez do plano aprovado (só para plan).' },
      date: { type: 'string', description: 'Primeiro dia da agenda, AAAA-MM-DD (só para agenda).' },
      days: { type: 'integer', description: 'Quantos dias de agenda, de 1 a 31 (só para agenda).' },
    }, required: ['sheet'],
    run: (ctx, p) => assistant.createSpreadsheet(ctx.db, ctx.uid, p, ctx.lastSeen),
  },

  // Memória: o jeito de trabalhar dela e as pendências
  {
    name: 'list_preferences', kind: 'read', title: 'Preferências anotadas',
    description: 'Lê as preferências de trabalho que a nutricionista pediu para a Ali lembrar.',
    params: {}, required: [],
    run: (ctx) => memory.listPreferences(ctx.db, ctx.uid),
  },
  {
    name: 'remember_preference', kind: 'write', title: 'Lembrar uma preferência', idempotent: true,
    description: 'Guarda uma preferência de trabalho dela para as próximas conversas e para os rascunhos de plano. Use quando ela disser "lembre que eu sempre…" ou "prefiro…". Não use para dados de um paciente: esses vão para a ficha clínica ou para a anotação da consulta.',
    params: { text: { type: 'string', description: 'A preferência em uma frase curta, sem nome de paciente.' } }, required: ['text'],
    run: (ctx, p) => memory.rememberPreference(ctx.db, ctx.uid, { text: p.text }, 'ali'),
  },
  {
    name: 'forget_preference', kind: 'write', title: 'Esquecer uma preferência',
    description: 'Apaga uma preferência de trabalho que a Ali tinha guardado.',
    params: { text: { type: 'string', description: 'Palavras da preferência que ela quer apagar.' } }, required: ['text'],
    run: (ctx, p) => memory.forgetPreference(ctx.db, ctx.uid, { text: p.text }),
  },
  {
    name: 'list_followups', kind: 'read', title: 'Pendências',
    description: 'Lê as pendências e os lembretes abertos da nutricionista, de todos ou de um paciente.',
    params: {
      patientName: { type: 'string', description: 'Nome do paciente (opcional).' },
      scope: { type: 'string', description: 'due = só as atrasadas e as de hoje (opcional).', options: ['all', 'due'] },
    }, required: [],
    run: (ctx, p) => withOptionalPatient(ctx, p.patientName, async (patient) => memory.listFollowups(ctx.db, ctx.uid, { ...(patient ? { patientUid: patient.uid } : {}), scope: p.scope }, await todayOf(ctx))),
  },
  {
    name: 'add_followup', kind: 'write', title: 'Anotar uma pendência',
    description: 'Anota uma pendência ou lembrete para a nutricionista, ligada ou não a um paciente. Exemplo: "cobrar o exame de sangue da Ana até sexta".',
    params: {
      text: { type: 'string', description: 'O que ficou pendente, em uma frase curta.' },
      patientName: { type: 'string', description: 'Nome do paciente (opcional).' },
      dueDate: { type: 'string', description: 'Prazo no formato AAAA-MM-DD (opcional).' },
    }, required: ['text'],
    run: (ctx, p) => withOptionalPatient(ctx, p.patientName, async (patient) => memory.addFollowup(ctx.db, ctx.uid, patient, { text: p.text, dueDate: p.dueDate }, await todayOf(ctx), 'ali')),
  },
  {
    name: 'complete_followup', kind: 'write', title: 'Concluir uma pendência',
    description: 'Marca uma pendência como resolvida.',
    params: { text: { type: 'string', description: 'Palavras da pendência resolvida.' }, patientName: { type: 'string', description: 'Nome do paciente (opcional).' } }, required: ['text'],
    run: (ctx, p) => withOptionalPatient(ctx, p.patientName, (patient) => memory.completeFollowup(ctx.db, ctx.uid, { text: p.text, ...(patient ? { patientUid: patient.uid } : {}) })),
  },
  {
    name: 'search_records', kind: 'read', title: 'Procurar nos registros',
    description: 'Procura uma palavra nas fichas clínicas, anotações de consulta, pendências e pacientes dela. Use para "quais pacientes têm…" ou "onde anotei…". É busca por palavra, não por significado.',
    params: { query: { type: 'string', description: 'Uma ou duas palavras para procurar, como lactose ou diabetes.' } }, required: ['query'],
    run: async (ctx, p) => brain.searchRecords(ctx.db, ctx.uid, { query: p.query }, await zoneOf(ctx)),
  },

  // Contas de apoio (estimativas: quem decide é a nutricionista)
  {
    name: 'calculate_energy_needs', kind: 'read', title: 'Calcular gasto de energia',
    description: 'Estima o gasto de energia em repouso e o gasto total do dia de um adulto (Mifflin-St Jeor ou Harris-Benedict). Com o nome do paciente, usa peso, altura, idade, sexo e atividade do prontuário e da ficha.',
    params: {
      patientName: PATIENT_OPTIONAL, weight: WEIGHT, height: HEIGHT, age: AGE,
      sex: { type: 'string', description: 'Sexo.', options: ['F', 'M'] },
      activity: { type: 'string', description: 'Nível de atividade física.', options: ['sedentario', 'leve', 'moderado', 'intenso', 'muito_intenso'] },
      formula: { type: 'string', description: 'Fórmula (sem dizer, vale mifflin).', options: ['mifflin', 'harris'] },
    }, required: [],
    run: (ctx, p) => withOptionalPatient(ctx, p.patientName, (patient) => brain.energyNeedsFor(ctx.db, ctx.uid, patient, { weight: p.weight, height: p.height, age: p.age, sex: p.sex, activity: p.activity, formula: p.formula })),
  },
  {
    name: 'calculate_body_metrics', kind: 'read', title: 'Calcular IMC',
    description: 'Calcula o IMC, a classificação (OMS para adultos, Lipschitz a partir de 60 anos) e a faixa de peso para a altura. Com o nome do paciente, usa os dados do prontuário.',
    params: { patientName: PATIENT_OPTIONAL, weight: WEIGHT, height: HEIGHT, age: AGE }, required: [],
    run: (ctx, p) => withOptionalPatient(ctx, p.patientName, (patient) => brain.bodyMetricsFor(ctx.db, ctx.uid, patient, { weight: p.weight, height: p.height, age: p.age })),
  },
  {
    name: 'calculate_macros', kind: 'read', title: 'Dividir calorias em macros',
    description: 'Divide as calorias do dia em gramas de proteína, carboidrato e gordura, a partir da proteína por quilo e do percentual de gordura que ela escolher.',
    params: {
      kcal: { type: 'number', description: 'Calorias por dia.' },
      patientName: PATIENT_OPTIONAL, weight: WEIGHT,
      proteinPerKg: { type: 'number', description: 'Gramas de proteína por quilo de peso (sem dizer, vale 1,6).' },
      fatPercent: { type: 'number', description: 'Percentual das calorias vindo de gordura (sem dizer, vale 30).' },
    }, required: ['kcal'],
    run: (ctx, p) => withOptionalPatient(ctx, p.patientName, (patient) => brain.macrosFor(ctx.db, ctx.uid, patient, { kcal: p.kcal, weight: p.weight, proteinPerKg: p.proteinPerKg, fatPercent: p.fatPercent })),
  },

  // Tabela de alimentos (TACO)
  {
    name: 'food_info', kind: 'read', title: 'Calorias de um alimento',
    description: 'Calorias, proteína, carboidrato, gordura e fibra de um alimento pela tabela TACO.',
    params: { food: { type: 'string', description: 'Nome do alimento.' }, grams: GRAMS }, required: ['food'],
    run: (_ctx, p) => foodInfo(p.food, p.grams),
  },
  {
    name: 'food_nutrients', kind: 'read', title: 'Vitaminas e minerais de um alimento',
    description: 'Todos os nutrientes de um alimento pela tabela TACO: minerais, vitaminas e tipos de gordura. Use quando ela perguntar de ferro, cálcio, sódio, vitamina C e outros de um alimento.',
    params: {
      food: { type: 'string', description: 'Nome do alimento.' }, grams: GRAMS,
      group: { type: 'string', description: 'Grupo de nutrientes para falar (sem dizer, os principais).', options: ['principais', 'minerais', 'vitaminas', 'gorduras', 'tudo'] },
    }, required: ['food'],
    run: (_ctx, p) => foods.foodNutrients({ food: p.food, grams: p.grams, group: p.group }),
  },
  {
    name: 'compare_foods', kind: 'read', title: 'Comparar alimentos',
    description: 'Compara dois ou três alimentos pela tabela TACO, na mesma quantidade.',
    params: { foods: { type: 'string[]', description: 'Dois ou três alimentos.' }, grams: GRAMS }, required: ['foods'],
    run: (_ctx, p) => foods.compareFoods({ foods: p.foods, grams: p.grams }),
  },
  {
    name: 'find_food_sources', kind: 'read', title: 'Alimentos ricos em um nutriente',
    description: 'Lista os alimentos da tabela TACO com mais de um nutriente (ferro, cálcio, proteína, fibra, potássio, vitamina C e outros) em 100 gramas.',
    params: {
      nutrient: { type: 'string', description: 'Nome do nutriente em português.' },
      category: { type: 'string', description: 'Grupo de alimentos para filtrar, como frutas, carnes ou leguminosas (opcional).' },
      limit: { type: 'integer', description: 'Quantos alimentos, de 3 a 10 (sem dizer, vale 5).' },
    }, required: ['nutrient'],
    run: (_ctx, p) => foods.foodSources({ nutrient: p.nutrient, category: p.category, limit: p.limit }),
  },
];

const ACTIONS_BY_NAME = new Map(NUTRITIONIST_ACTIONS.map((def) => [def.name, def]));

export function findAction(name: unknown): ActionDef | null {
  return typeof name === 'string' ? ACTIONS_BY_NAME.get(name) || null : null;
}

/**
 * Roda uma ação da lista. Quem chama já conferiu o login, o papel e a aprovação do cadastro. Aqui ficam as duas regras
 * que valem para qualquer porta de entrada: só ação da lista, e ação que grava ou envia só com confirmed === true.
 */
export async function runNutritionistAction(ctx: ActionContext, name: unknown, payload: ActionPayload, confirmed: unknown): Promise<ActionResult> {
  const def = findAction(name);
  if (!def) return { ok: false, status: 400, speech: 'Ação não reconhecida.' };
  if (def.kind === 'write' && confirmed !== true) return { ok: false, status: 422, speech: 'Confirme com a nutricionista antes de executar esta ação.' };
  return def.run(ctx, payload);
}

const CONFIRMED_PARAM = 'Envie true só depois que a nutricionista ouviu o que vai ser feito e disse sim nesta conversa.';

/** Os campos da ação no formato JSON Schema (para a lista de ferramentas do MCP). Ação que grava ganha o campo confirmed. */
export function actionInputSchema(def: ActionDef): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [key, param] of Object.entries(def.params)) {
    properties[key] = param.type === 'string[]'
      ? { type: 'array', items: { type: 'string' }, description: param.description }
      : { type: param.type, description: param.description, ...(param.options ? { enum: param.options } : {}) };
  }
  if (def.kind === 'write') properties.confirmed = { type: 'boolean', description: CONFIRMED_PARAM };
  return { type: 'object', properties, required: def.kind === 'write' ? [...def.required, 'confirmed'] : def.required };
}
