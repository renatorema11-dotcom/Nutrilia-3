'use client';

import { useState, useEffect, useRef } from 'react';
import { auth, onAuthStateChanged } from '@/lib/firebase';
import { useConversation, ConversationProvider } from '@elevenlabs/react';
import { Button } from '@/components/ui';
import { Mic, MicOff, Loader2, Bot } from 'lucide-react';

// Valores usados se a personalização da nutricionista não carregar: a Ali precisa receber todas as variáveis.
const DEFAULT_ALI_CONTEXT: Record<string, string> = {
  patientFirstName: 'tudo bem',
  nutritionistName: 'sua nutricionista',
  attendanceInfo: 'Horários de atendimento não informados.',
  clinicInfo: 'Nenhuma informação do consultório cadastrada.',
  nutritionistGuidelines: 'Nenhuma orientação adicional.',
  agendaStatus: 'nao_conectada',
};

/** Personalização da Ali definida pela nutricionista do paciente (horários, consultório, orientações). */
async function loadAliContext(token: string): Promise<Record<string, string>> {
  try {
    const res = await fetch('/api/ali/context', { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!res.ok) return DEFAULT_ALI_CONTEXT;
    const data = await res.json();
    const vars = data?.dynamicVariables;
    if (!vars || typeof vars !== 'object') return DEFAULT_ALI_CONTEXT;
    return Object.fromEntries(Object.keys(DEFAULT_ALI_CONTEXT).map((key) => [
      key, typeof vars[key] === 'string' && vars[key] ? vars[key] : DEFAULT_ALI_CONTEXT[key],
    ]));
  } catch {
    return DEFAULT_ALI_CONTEXT;
  }
}

function AgentInner({
  agentId,
  dynamicVariables,
}: {
  agentId: string;
  dynamicVariables?: Record<string, string>;
}) {
  const { startSession, endSession, status, isSpeaking } = useConversation();

  const [sessionError, setSessionError] = useState('');
  const [starting, setStarting] = useState(false);
  const sessionUid = useRef<string | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, current => {
      if (sessionUid.current && current?.uid !== sessionUid.current) {
        void endSession();
        sessionUid.current = null;
      }
    });
    return () => { unsubscribe(); if (expiryTimer.current) clearTimeout(expiryTimer.current); };
  }, [endSession]);

  const handleToggleSession = async () => {
    if (status === 'connected') {
      await endSession();
      sessionUid.current = null;
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
    } else {
      setSessionError('');
      setStarting(true);
      try {
        const current = auth.currentUser;
        if (!current || current.isAnonymous) throw new Error('Entre com sua conta de paciente para conversar com a Ali.');
        const token = await current.getIdToken(true);
        if (auth.currentUser?.uid !== current.uid) throw new Error('Sua sessão mudou. Entre novamente.');
        const aliContext = await loadAliContext(token);
        sessionUid.current = current.uid;
        await startSession({ agentId, dynamicVariables: {
          ...aliContext, ...dynamicVariables, patientUid: current.uid, secret__patientToken: token,
        } });
        if (auth.currentUser?.uid !== current.uid) {
          await endSession();
          throw new Error('Sessão alterada durante a conexão.');
        }
        // O ID token expira em uma hora. Encerrar antes disso exige nova autenticação.
        if (expiryTimer.current) clearTimeout(expiryTimer.current);
        expiryTimer.current = setTimeout(() => {
          void endSession();
          sessionUid.current = null;
          setSessionError('Inicie uma nova conversa para renovar sua sessão.');
        }, 50 * 60 * 1000);
      } catch {
        sessionUid.current = null;
        setSessionError('Não foi possível iniciar a Ali. Entre com sua conta de paciente e tente novamente.');
      } finally { setStarting(false); }
    }
  };

  return (
    // No celular fica compacto (texto à esquerda, botão à direita); no computador, em coluna.
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 p-4 bg-teal-50 rounded-xl border border-teal-100 lg:flex lg:flex-col lg:items-center lg:gap-4">
      <div className="text-left lg:text-center space-y-1 lg:space-y-2">
        <h3 className="font-semibold text-teal-900 flex items-center lg:justify-center gap-2">
          <Bot className="w-5 h-5 text-teal-600" />
          Ali — Assistente de Voz
        </h3>
        <p className="text-sm text-slate-600">
          Converse com o Ali: registre seu peso, anote refeições e peça consultas
        </p>
      </div>

      <div className="relative row-span-2">
        <div className={`absolute inset-0 bg-teal-500 rounded-full blur-xl opacity-20 transition-all duration-500 ${isSpeaking ? 'scale-150 opacity-40' : 'scale-100 opacity-20'}`} />
        <Button
          onClick={handleToggleSession}
          disabled={starting || status === 'connecting'}
          className={`relative h-16 w-16 rounded-full flex items-center justify-center transition-all ${
            status === 'connected' 
              ? 'bg-red-500 hover:bg-red-600 shadow-red-500/30' 
              : 'bg-teal-600 hover:bg-teal-700 shadow-teal-600/30'
          }`}
        >
          {status === 'connecting' ? (
            <Loader2 className="w-6 h-6 text-white animate-spin" />
          ) : status === 'connected' ? (
            <MicOff className="w-6 h-6 text-white" />
          ) : (
            <Mic className="w-6 h-6 text-white" />
          )}
        </Button>
      </div>
      
      <div className="justify-self-start text-xs font-medium px-3 py-1 bg-white rounded-full border border-teal-200 text-teal-800">
        Status: {status === 'connected' ? 'Conectado' : status === 'connecting' ? 'Conectando...' : 'Desconectado'}
      </div>

      {sessionError && <p role="alert" className="col-span-2 text-sm text-red-700">{sessionError}</p>}
      {status === 'connected' && (
        <div className="col-span-2 text-xs text-slate-500 animate-pulse">
          {isSpeaking ? 'O Ali está falando...' : 'Ouvindo...'}
        </div>
      )}
    </div>
  );
}

export function ElevenLabsAgent({
  agentId,
  dynamicVariables,
}: {
  agentId?: string;
  dynamicVariables?: Record<string, string>;
}) {
  // Se não houver agentId, mostramos um aviso para configuração
  if (!agentId) {
    return (
      <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-center space-y-3">
        <Bot className="w-8 h-8 text-slate-400 mx-auto" />
        <h3 className="font-semibold text-slate-700">Agente ElevenLabs não configurado</h3>
        <p className="text-sm text-slate-500">
          Para ativar o assistente de voz, configure a variável <code className="bg-slate-200 px-1 py-0.5 rounded">NEXT_PUBLIC_ELEVENLABS_AGENT_ID</code> no ambiente.
        </p>
      </div>
    );
  }

  return (
    <ConversationProvider>
      <AgentInner agentId={agentId} dynamicVariables={dynamicVariables} />
    </ConversationProvider>
  );
}
