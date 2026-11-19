// Servidor MCP (Model Context Protocol) da Ali das nutricionistas: só o protocolo JSON-RPC 2.0, sem banco, sem rede
// e sem segredos. A rota HTTP lê o corpo, faz o JSON.parse e entrega aqui; tudo o que é dado (ferramentas, recursos,
// prompts e se a nutricionista está logada) chega pelo McpHost que a rota monta.
// Transporte "Streamable HTTP" sem sessão e sem SSE: cada pedido é respondido sozinho, em JSON.

export interface McpToolDef { name: string; title: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean; destructive?: boolean; idempotent?: boolean; openWorld?: boolean }
export interface McpToolOutcome { ok: boolean; speech: string; data?: Record<string, unknown> }
export interface McpResourceDef { uri: string; name: string; title: string; description: string; mimeType: string }
export interface McpResourceTemplateDef { uriTemplate: string; name: string; title: string; description: string; mimeType: string }
export interface McpPromptDef { name: string; title: string; description: string; arguments: { name: string; description: string; required: boolean }[] }
export interface McpHost {
  serverInfo: { name: string; title: string; version: string };
  instructions: string;
  /** false = só o segredo do servidor chegou (sem a nutricionista): listar pode, executar/ler dados não. */
  authenticated: boolean;
  tools: McpToolDef[];
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolOutcome>;
  resources: McpResourceDef[];
  resourceTemplates: McpResourceTemplateDef[];
  /** null = não existe. */
  readResource(uri: string): Promise<{ mimeType: string; text: string } | null>;
  prompts: McpPromptDef[];
  /** null = não existe; string = erro de argumento para devolver como -32602. */
  getPrompt(name: string, args: Record<string, string>): Promise<{ description: string; text: string } | null | string>;
}

/** Versões do protocolo que este servidor entende, da mais nova para a mais antiga. */
export const MCP_PROTOCOL_VERSIONS: readonly string[] = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export const MCP_ERRORS = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603, unauthorized: -32001, resourceNotFound: -32002 };
/** Defesa: itens por lote, tamanho de nomes e uris, e quanto do que o cliente mandou pode voltar numa mensagem de erro. */
export const MCP_LIMITS = { batch: 20, name: 200, echo: 200 };
/** Até quantos caracteres os dados da ferramenta também vão como texto JSON no resultado. */
const MCP_JSON_TEXT_MAX = 30_000;

const MCP_NOT_LOGGED = 'Sua sessão no NutriAli expirou ou não foi confirmada. Entre novamente na sua conta de nutricionista para eu poder fazer isso.';
const MCP_TOOL_FAILED = 'Não consegui fazer isso agora. Tente de novo em instantes.';
const MCP_UNAUTHORIZED = 'Não autorizado. Entre novamente na sua conta de nutricionista no NutriAli.';

type McpId = string | number;
interface McpError { code: number; message: string; data?: unknown }
type McpReply = { jsonrpc: '2.0'; id: McpId | null; result: unknown } | { jsonrpc: '2.0'; id: McpId | null; error: McpError };

const mcpIsObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
// O MCP pede id texto ou inteiro, nunca null. Texto enorme não volta na resposta: vira pedido inválido.
const mcpValidId = (value: unknown): value is McpId => (typeof value === 'string' && value.length <= MCP_LIMITS.echo) || (typeof value === 'number' && Number.isInteger(value));
const mcpResult = (id: McpId | null, result: unknown): McpReply => ({ jsonrpc: '2.0', id, result });
const mcpError = (id: McpId | null, code: number, message: string, data?: unknown): McpReply => ({ jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } });
const mcpText = (text: string) => ({ type: 'text', text });

/** Pedaço do que o cliente mandou, para citar num erro: sem caracteres de controle e com no máximo 200 caracteres. */
function mcpEcho(value: unknown): string {
  return String(value).slice(0, MCP_LIMITS.echo * 2).replace(/[\u0000-\u001F\u007F]/g, '').slice(0, MCP_LIMITS.echo);
}

/** As listas do host podem chegar faltando por engano da rota: vira lista vazia em vez de derrubar o pedido. */
function mcpArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

/** Cópia dos argumentos sem a chave __proto__, para nada mexer no protótipo de objetos do servidor. */
function mcpArgs(raw: unknown): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (mcpIsObject(raw)) for (const [key, value] of Object.entries(raw)) if (key !== '__proto__') args[key] = value;
  return args;
}

/** Os dados extras do resultado como JSON puro (sem funções, undefined ou referência circular). Sem ok/speech: esses vêm do resultado. */
function mcpPlainData(data: unknown): Record<string, unknown> {
  if (!mcpIsObject(data)) return {};
  try {
    const plain = JSON.parse(JSON.stringify(data));
    if (!mcpIsObject(plain)) return {};
    delete plain.ok;
    delete plain.speech;
    return plain;
  } catch {
    return {};
  }
}

/** O texto que a IA recebe de uma ferramenta: a fala da Ali, ou um aviso curto quando a fala veio vazia. */
export function mcpToolResultText(outcome: McpToolOutcome | null | undefined): string {
  const speech = mcpIsObject(outcome) && typeof outcome.speech === 'string' ? outcome.speech.trim() : '';
  if (speech) return speech;
  return mcpIsObject(outcome) && outcome.ok === true ? 'Pronto.' : MCP_TOOL_FAILED;
}

function mcpInitialize(params: Record<string, unknown>, host: McpHost) {
  // Negociação: devolve a versão pedida quando a conhecemos; senão a mais nova, e o cliente decide se continua.
  const asked = params.protocolVersion;
  const protocolVersion = typeof asked === 'string' && MCP_PROTOCOL_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
  const info: Partial<McpHost['serverInfo']> = mcpIsObject(host.serverInfo) ? host.serverInfo : {};
  const serverInfo = { name: String(info.name || 'nutriali'), title: String(info.title || info.name || 'NutriAli'), version: String(info.version || '1.0.0') };
  const capabilities = { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false }, prompts: { listChanged: false } };
  return typeof host.instructions === 'string' && host.instructions ? { protocolVersion, capabilities, serverInfo, instructions: host.instructions } : { protocolVersion, capabilities, serverInfo };
}

/** Ferramenta como o cliente vê: só os campos do protocolo, mais as dicas (annotations) de leitura, exclusão e repetição. */
function mcpToolEntry(tool: McpToolDef) {
  const readOnly = tool.readOnly === true;
  return {
    name: tool.name, title: tool.title, description: tool.description,
    inputSchema: mcpIsObject(tool.inputSchema) ? tool.inputSchema : { type: 'object' },
    annotations: {
      title: tool.title,
      readOnlyHint: readOnly,
      // Sem dizer nada, uma ferramenta que grava conta como destrutiva (padrão do MCP): o cliente pede confirmação.
      destructiveHint: readOnly ? false : tool.destructive !== false,
      idempotentHint: typeof tool.idempotent === 'boolean' ? tool.idempotent : readOnly,
      // As ferramentas mexem nos dados do próprio NutriAli; quem fala com o mundo de fora (e-mail, agenda) avisa com openWorld.
      openWorldHint: tool.openWorld === true,
    },
  };
}

async function mcpCallTool(id: McpId, params: Record<string, unknown>, host: McpHost): Promise<McpReply> {
  const name = params.name;
  if (typeof name !== 'string' || !name) return mcpError(id, MCP_ERRORS.invalidParams, 'Invalid params: name is required');
  const tool = name.length <= MCP_LIMITS.name ? mcpArray(host.tools).find((item) => item.name === name) : undefined;
  if (!tool) return mcpError(id, MCP_ERRORS.invalidParams, `Unknown tool: ${mcpEcho(name)}`);
  const raw = params.arguments;
  if (raw !== undefined && raw !== null && !mcpIsObject(raw)) return mcpError(id, MCP_ERRORS.invalidParams, 'Invalid params: arguments must be an object');
  // Sem a nutricionista confirmada nada é executado; vai como erro da ferramenta para a IA explicar a ela.
  if (host.authenticated !== true) return mcpResult(id, { content: [mcpText(MCP_NOT_LOGGED)], isError: true });
  let outcome: McpToolOutcome;
  try {
    outcome = await host.callTool(tool.name, mcpArgs(raw));
  } catch {
    // O texto do erro pode ter detalhes internos: a IA só recebe o aviso genérico (a rota registra o erro de verdade).
    return mcpResult(id, { content: [mcpText(MCP_TOOL_FAILED)], isError: true });
  }
  const ok = mcpIsObject(outcome) && outcome.ok === true;
  const speech = mcpToolResultText(outcome);
  const data = mcpPlainData(mcpIsObject(outcome) ? outcome.data : null);
  const structured = { ok, speech, ...data };
  // A especificação pede o mesmo conteúdo em texto (versões antigas não têm structuredContent). Muito grande, fica só no structuredContent.
  const json = Object.keys(data).length ? JSON.stringify(structured) : '';
  const content = json && json.length <= MCP_JSON_TEXT_MAX ? [mcpText(speech), mcpText(json)] : [mcpText(speech)];
  return mcpResult(id, { content, structuredContent: structured, isError: !ok });
}

async function mcpReadResource(id: McpId, params: Record<string, unknown>, host: McpHost): Promise<McpReply> {
  const uri = params.uri;
  if (typeof uri !== 'string' || !uri) return mcpError(id, MCP_ERRORS.invalidParams, 'Invalid params: uri is required');
  if (host.authenticated !== true) return mcpError(id, MCP_ERRORS.unauthorized, MCP_UNAUTHORIZED);
  const found = uri.length <= MCP_LIMITS.name ? await host.readResource(uri) : null;
  if (!mcpIsObject(found)) return mcpError(id, MCP_ERRORS.resourceNotFound, 'Resource not found', { uri: mcpEcho(uri) });
  if (typeof found.text !== 'string') throw new Error('recurso sem texto');
  const mimeType = typeof found.mimeType === 'string' && found.mimeType ? found.mimeType : 'text/plain';
  return mcpResult(id, { contents: [{ uri, mimeType, text: found.text }] });
}

async function mcpGetPrompt(id: McpId, params: Record<string, unknown>, host: McpHost): Promise<McpReply> {
  const name = params.name;
  if (typeof name !== 'string' || !name) return mcpError(id, MCP_ERRORS.invalidParams, 'Invalid params: name is required');
  const raw = params.arguments;
  if (raw !== undefined && raw !== null && !mcpIsObject(raw)) return mcpError(id, MCP_ERRORS.invalidParams, 'Invalid params: arguments must be an object');
  // No MCP os argumentos de prompt são texto; número e sim/não viram texto, o resto é recusado.
  const args: Record<string, string> = {};
  for (const [key, value] of Object.entries(mcpArgs(raw))) {
    if (typeof value === 'string') args[key] = value;
    else if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean') args[key] = String(value);
    else return mcpError(id, MCP_ERRORS.invalidParams, `Invalid params: argument ${mcpEcho(key)} must be a string`);
  }
  // Só o que aparece na lista pode ser pedido, como nas ferramentas.
  const listed = name.length <= MCP_LIMITS.name && mcpArray(host.prompts).some((item) => item.name === name);
  const prompt = listed ? await host.getPrompt(name, args) : null;
  if (typeof prompt === 'string') return mcpError(id, MCP_ERRORS.invalidParams, prompt.slice(0, 1000) || 'Invalid params');
  if (!mcpIsObject(prompt)) return mcpError(id, MCP_ERRORS.invalidParams, `Unknown prompt: ${mcpEcho(name)}`);
  if (typeof prompt.text !== 'string') throw new Error('prompt sem texto');
  const description = typeof prompt.description === 'string' ? prompt.description : '';
  return mcpResult(id, { description, messages: [{ role: 'user', content: mcpText(prompt.text) }] });
}

async function mcpDispatch(id: McpId, method: string, params: Record<string, unknown>, host: McpHost): Promise<McpReply> {
  switch (method) {
    case 'initialize': return mcpResult(id, mcpInitialize(params, host));
    case 'ping': return mcpResult(id, {});
    // Sem paginação: as listas são pequenas, então o cursor é ignorado e nunca há nextCursor.
    case 'tools/list': return mcpResult(id, { tools: mcpArray(host.tools).map(mcpToolEntry) });
    case 'tools/call': return mcpCallTool(id, params, host);
    case 'resources/list':
      return mcpResult(id, { resources: mcpArray(host.resources).map((r) => ({ uri: r.uri, name: r.name, title: r.title, description: r.description, mimeType: r.mimeType })) });
    case 'resources/templates/list':
      return mcpResult(id, { resourceTemplates: mcpArray(host.resourceTemplates).map((t) => ({ uriTemplate: t.uriTemplate, name: t.name, title: t.title, description: t.description, mimeType: t.mimeType })) });
    case 'resources/read': return mcpReadResource(id, params, host);
    case 'prompts/list':
      return mcpResult(id, {
        prompts: mcpArray(host.prompts).map((p) => ({
          name: p.name, title: p.title, description: p.description,
          arguments: mcpArray(p.arguments).map((a) => ({ name: a.name, description: a.description, required: a.required === true })),
        })),
      });
    case 'prompts/get': return mcpGetPrompt(id, params, host);
    // logging/setLevel, completion/complete, resources/subscribe e o resto: não oferecemos (nem anunciamos no initialize).
    default: return mcpError(id, MCP_ERRORS.methodNotFound, 'Method not found', { method: mcpEcho(method) });
  }
}

/** Um item do JSON-RPC: a resposta (null quando é aviso ou resposta do cliente) e se o envelope veio inválido. */
async function mcpHandleMessage(message: unknown, host: McpHost): Promise<{ reply: McpReply | null; invalid: boolean }> {
  const invalid = (id: McpId | null) => ({ reply: mcpError(id, MCP_ERRORS.invalidRequest, 'Invalid Request'), invalid: true });
  if (!mcpIsObject(message)) return invalid(null);
  const id = message.id;
  const knownId = mcpValidId(id) ? id : null;
  if (message.jsonrpc !== '2.0') return invalid(knownId);
  if (message.method === undefined) {
    // Resposta do cliente (este servidor nunca pergunta nada a ele): só se confirma o recebimento.
    const answer = ('result' in message || 'error' in message) && (id === null || mcpValidId(id));
    return answer ? { reply: null, invalid: false } : invalid(knownId);
  }
  if (typeof message.method !== 'string') return invalid(knownId);
  // Aviso (sem id), como notifications/initialized ou notifications/cancelled: não tem resposta.
  if (id === undefined) return { reply: null, invalid: false };
  if (knownId === null) return invalid(null);
  const params = message.params === undefined || message.params === null ? {} : message.params;
  if (Array.isArray(params)) return { reply: mcpError(knownId, MCP_ERRORS.invalidParams, 'Invalid params'), invalid: false };
  if (!mcpIsObject(params)) return invalid(knownId);
  try {
    return { reply: await mcpDispatch(knownId, message.method, params, host), invalid: false };
  } catch {
    // Falha do host ou da rota: erro genérico, sem o texto da exceção.
    return { reply: mcpError(knownId, MCP_ERRORS.internal, 'Internal error'), invalid: false };
  }
}

/** Trata o corpo já lido (JSON.parse feito pelo chamador; `undefined` = JSON inválido). Devolve o status HTTP e o corpo (null = sem corpo, 202). */
export async function handleMcpPayload(payload: unknown, host: McpHost): Promise<{ status: number; body: unknown | null }> {
  if (payload === undefined) return { status: 400, body: mcpError(null, MCP_ERRORS.parse, 'Parse error') };
  if (Array.isArray(payload)) {
    // Lote (permitido na versão 2025-03-26): um item por vez, na ordem, para gravar e depois ler funcionar.
    if (!payload.length) return { status: 400, body: mcpError(null, MCP_ERRORS.invalidRequest, 'Invalid Request: empty batch') };
    if (payload.length > MCP_LIMITS.batch) return { status: 400, body: mcpError(null, MCP_ERRORS.invalidRequest, `Invalid Request: batch too large (max ${MCP_LIMITS.batch})`) };
    const replies: McpReply[] = [];
    for (const item of payload) {
      const { reply } = await mcpHandleMessage(item, host);
      if (reply) replies.push(reply);
    }
    return replies.length ? { status: 200, body: replies } : { status: 202, body: null };
  }
  const { reply, invalid } = await mcpHandleMessage(payload, host);
  if (!reply) return { status: 202, body: null };
  return { status: invalid ? 400 : 200, body: reply };
}
