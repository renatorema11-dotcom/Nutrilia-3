// Credencial de conversa das Alis, emitida pelo servidor com a chave da ElevenLabs (ELEVENLABS_API_KEY).
// Com ela os agentes podem exigir autenticação: só quem está logado no app consegue abrir uma conversa,
// e ninguém gasta minutos de voz usando só o identificador do agente.
const ELEVEN_CONVERSATION_API = 'https://api.elevenlabs.io/v1/convai/conversation';

// Identificadores públicos dos agentes (os mesmos que as telas usam).
export const ALI_PATIENT_AGENT = 'agent_4901kze5k1xhe5590n67kh1pby82';
export const ALI_NUTRITIONIST_AGENT = 'agent_2201m4kp5pz6e85tp9demzjejpm0';

export type AliSessionMode = 'voice' | 'text';
export type AliSession =
  | { ok: true; conversationToken?: string; signedUrl?: string }
  | { ok: false; status: number; reason: 'not_configured' | 'unavailable' };

/**
 * Pede à ElevenLabs a credencial para uma conversa: por voz é um token (WebRTC), por texto é um endereço assinado (WebSocket).
 * O agente é escolhido pelo perfil de quem está logado, nunca pelo navegador.
 */
export async function createAliSession(role: 'patient' | 'nutritionist', mode: AliSessionMode): Promise<AliSession> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { ok: false, status: 503, reason: 'not_configured' };
  const agentId = role === 'nutritionist' ? ALI_NUTRITIONIST_AGENT : process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID || ALI_PATIENT_AGENT;
  const path = mode === 'text' ? 'get-signed-url' : 'token';
  try {
    const res = await fetch(`${ELEVEN_CONVERSATION_API}/${path}?agent_id=${encodeURIComponent(agentId)}`, {
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}));
    const value = mode === 'text' ? data?.signed_url : data?.token;
    if (!res.ok || typeof value !== 'string' || !value) {
      console.warn(`Ali: a ElevenLabs não emitiu a credencial de conversa (resposta ${res.status}).`);
      return { ok: false, status: 502, reason: 'unavailable' };
    }
    return mode === 'text' ? { ok: true, signedUrl: value } : { ok: true, conversationToken: value };
  } catch {
    console.warn('Ali: falha ao pedir a credencial de conversa à ElevenLabs.');
    return { ok: false, status: 502, reason: 'unavailable' };
  }
}
