// Chamadas do navegador às rotas do próprio app que exigem login: levam o ID token do Firebase no cabeçalho.
import { auth } from './firebase';

export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const user = auth.currentUser;
  if (user) headers.set('authorization', `Bearer ${await user.getIdToken()}`);
  return fetch(input, { ...init, headers });
}

/** Erro com mensagem pronta para mostrar na tela (vinda do servidor, em português). */
export class ApiError extends Error {}

/** POST com JSON e login. Devolve a resposta lida ou lança ApiError com a mensagem do servidor. */
export async function postJson(url: string, body: unknown): Promise<any> {
  const res = await authFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(typeof data?.error === 'string' ? data.error : 'Não foi possível concluir o pedido agora.');
  return data;
}
