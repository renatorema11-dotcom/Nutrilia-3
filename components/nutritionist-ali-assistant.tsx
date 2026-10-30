'use client';

import { useEffect, useRef, useState } from 'react';
import { ConversationProvider, useConversation } from '@elevenlabs/react';
import { Bot, Loader2, Mic, PhoneOff, Send, X } from 'lucide-react';
import { auth, onAuthStateChanged } from '@/lib/firebase';
import { aliSessionAuth } from '@/lib/api-client';
import { describeDates } from '@/lib/agenda';

// Agente da ElevenLabs só para nutricionistas (o dos pacientes é outro). O ID é público.
const NUTRITIONIST_AGENT_ID = 'agent_2201m4kp5pz6e85tp9demzjejpm0';

// Valores usados se o contexto não carregar: a Ali precisa receber todas as variáveis.
function defaultContext(): Record<string, string> {
  return {
    nutritionistName: 'nutricionista',
    patientCount: '0',
    attendanceInfo: 'Horários de atendimento não informados.',
    clinicInfo: 'Nenhuma informação do consultório cadastrada.',
    googleStatus: 'nao_conectado',
    dateInfo: describeDates(new Date(), 'America/Sao_Paulo'),
  };
}

async function loadContext(token: string): Promise<Record<string, string>> {
  const fallback = defaultContext();
  try {
    const res = await fetch('/api/ali/nutritionist-context', { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!res.ok) return fallback;
    const vars = (await res.json())?.dynamicVariables;
    if (!vars || typeof vars !== 'object') return fallback;
    return Object.fromEntries(Object.keys(fallback).map((key) => [
      key, typeof vars[key] === 'string' && vars[key] ? vars[key] : fallback[key],
    ]));
  } catch {
    return fallback;
  }
}

interface ChatMessage { id: number; role: 'user' | 'agent'; text: string }

const SUGGESTIONS = ['Quais pacientes eu tenho?', 'O que eu tenho na agenda amanhã?', 'Quero mandar um e-mail para um paciente'];

function AssistantPanel({ onClose }: { onClose: () => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [voice, setVoice] = useState(false);
  const nextId = useRef(0);
  const pendingText = useRef<string | null>(null);
  const voiceSession = useRef(false);
  const sessionUid = useRef<string | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listEnd = useRef<HTMLDivElement | null>(null);

  const addMessage = (role: ChatMessage['role'], value: string) => {
    setMessages((list) => [...list, { id: nextId.current++, role, text: value }]);
  };

  const { startSession, endSession, sendUserMessage, status, isSpeaking } = useConversation({
    onMessage: ({ message, role }) => {
      // O que foi digitado já está na tela; da nutricionista só entra o que ela falou por voz.
      if (role === 'user' && !voiceSession.current) return;
      if (message) addMessage(role, message);
    },
    onError: () => setError('A conversa com a Ali foi interrompida. Tente de novo.'),
  });

  const stop = () => {
    endSession();
    sessionUid.current = null;
    pendingText.current = null;
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (current) => {
      if (sessionUid.current && current?.uid !== sessionUid.current) {
        endSession();
        sessionUid.current = null;
      }
    });
    return () => {
      unsubscribe();
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
      endSession();
    };
  }, [endSession]);

  // A primeira mensagem digitada espera a conexão ficar pronta.
  useEffect(() => {
    if (status === 'connected' && pendingText.current) {
      sendUserMessage(pendingText.current);
      pendingText.current = null;
    }
  }, [status, sendUserMessage]);

  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: 'end' });
  }, [messages, status]);

  const begin = async (withVoice: boolean) => {
    setError('');
    setStarting(true);
    try {
      const current = auth.currentUser;
      if (!current || current.isAnonymous) throw new Error('sem login');
      const token = await current.getIdToken(true);
      const context = await loadContext(token);
      // O servidor emite a credencial da conversa para quem está logado; sem ela, vale o identificador do agente.
      const sessionAuth = await aliSessionAuth(token, withVoice ? 'voice' : 'text');
      if (auth.currentUser?.uid !== current.uid) throw new Error('sessão mudou');
      sessionUid.current = current.uid;
      voiceSession.current = withVoice;
      setVoice(withVoice);
      const dynamicVariables = { ...context, secret__nutritionistToken: token };
      if (sessionAuth && 'conversationToken' in sessionAuth) {
        startSession({ conversationToken: sessionAuth.conversationToken, dynamicVariables });
      } else if (sessionAuth && 'signedUrl' in sessionAuth) {
        startSession({ signedUrl: sessionAuth.signedUrl, textOnly: true, dynamicVariables });
      } else {
        startSession({ agentId: NUTRITIONIST_AGENT_ID, textOnly: !withVoice, dynamicVariables });
      }
      // O login vale por uma hora: encerra antes disso para renovar na próxima conversa.
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
      expiryTimer.current = setTimeout(() => {
        stop();
        setError('Comece uma nova conversa para renovar a sua sessão.');
      }, 50 * 60 * 1000);
    } catch {
      sessionUid.current = null;
      pendingText.current = null;
      setError('Não foi possível iniciar a Ali. Entre de novo com a sua conta e tente outra vez.');
    } finally {
      setStarting(false);
    }
  };

  const send = (value: string) => {
    const message = value.trim();
    if (!message || starting) return;
    setText('');
    addMessage('user', message);
    if (status === 'connected') {
      sendUserMessage(message);
    } else {
      pendingText.current = message;
      if (status !== 'connecting') void begin(false);
    }
  };

  const connected = status === 'connected';
  const busy = starting || status === 'connecting';
  const statusText = busy ? 'Conectando...'
    : connected && voice ? (isSpeaking ? 'A Ali está falando...' : 'Ouvindo você...')
    : connected ? 'Conversa por texto ativa'
    : 'Fale ou escreva para começar';

  return (
    <div role="dialog" aria-label="Ali, assistente da nutricionista"
      className="fixed z-50 inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] lg:inset-x-auto lg:right-6 lg:bottom-24 lg:w-[24rem] flex flex-col max-h-[70dvh] lg:max-h-[34rem] rounded-2xl bg-white border border-teal-100 shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 bg-teal-600 text-white">
        <div className="flex items-center gap-2 min-w-0">
          <Bot className="w-5 h-5 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold leading-tight"><span translate="no">Ali</span>, sua assistente</p>
            <p className="text-xs text-teal-50 truncate">{statusText}</p>
          </div>
        </div>
        <button type="button" onClick={() => { stop(); onClose(); }} aria-label="Fechar a Ali" className="p-1.5 rounded-lg hover:bg-white/15">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 min-h-[9rem] overflow-y-auto px-4 py-3 space-y-2 bg-slate-50">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">Peça por voz ou por escrito. Antes de enviar ou marcar qualquer coisa, eu confirmo com você.</p>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => send(suggestion)} disabled={busy}
                  className="text-left text-sm px-3 py-2 rounded-lg bg-white border border-slate-200 text-slate-700 hover:border-teal-300 disabled:opacity-60">
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <p className={`max-w-[85%] whitespace-pre-wrap break-words text-sm px-3 py-2 rounded-2xl ${message.role === 'user' ? 'bg-teal-600 text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'}`}>
              {message.text}
            </p>
          </div>
        ))}
        {busy && <p className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Conectando com a Ali...</p>}
        <div ref={listEnd} />
      </div>

      {error && <p role="alert" className="px-4 py-2 text-sm text-red-700 bg-red-50 border-t border-red-100">{error}</p>}

      <form onSubmit={(event) => { event.preventDefault(); send(text); }} className="flex items-center gap-2 p-3 border-t border-slate-200 bg-white">
        <input value={text} onChange={(event) => setText(event.target.value)} maxLength={1000} aria-label="Mensagem para a Ali"
          placeholder="Escreva para a Ali..." className="flex-1 min-w-0 rounded-lg border border-slate-200 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20" />
        <button type="submit" disabled={!text.trim() || starting} aria-label="Enviar mensagem"
          className="shrink-0 h-10 w-10 flex items-center justify-center rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
          <Send className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => (connected ? stop() : void begin(true))} disabled={busy}
          aria-label={connected ? 'Encerrar a conversa' : 'Falar com a Ali'} title={connected ? 'Encerrar a conversa' : 'Falar com a Ali'}
          className={`shrink-0 h-10 w-10 flex items-center justify-center rounded-lg text-white disabled:opacity-50 ${connected ? 'bg-red-500 hover:bg-red-600' : 'bg-slate-700 hover:bg-slate-800'}`}>
          {connected ? <PhoneOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </button>
      </form>
    </div>
  );
}

/**
 * Botão flutuante da Ali no painel da nutricionista. Diferente da Ali dos pacientes,
 * esta age em nome da nutricionista: pacientes dela, agenda e e-mails.
 */
export function NutritionistAliAssistant({ hideOnMobile }: { hideOnMobile: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={hideOnMobile ? 'hidden lg:block' : undefined}>
      {open && (
        <ConversationProvider>
          <AssistantPanel onClose={() => setOpen(false)} />
        </ConversationProvider>
      )}
      {!open && (
        <button type="button" onClick={() => setOpen(true)} aria-label="Abrir a Ali, sua assistente"
          className="fixed z-40 right-4 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] lg:right-6 lg:bottom-6 flex items-center gap-2 h-14 pl-4 pr-5 rounded-full bg-teal-600 text-white font-semibold shadow-lg shadow-teal-600/30 hover:bg-teal-700">
          <Bot className="w-6 h-6" />
          {/* translate="no": o tradutor automático trocava o nome pela palavra "There". */}
          <span translate="no">Ali</span>
        </button>
      )}
    </div>
  );
}
