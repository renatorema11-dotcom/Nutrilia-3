'use client';

import { useState } from 'react';
import { useConversation, ConversationProvider } from '@elevenlabs/react';
import { Button } from '@/components/ui';
import { Mic, MicOff, Loader2, Bot } from 'lucide-react';

function AgentInner({ agentId }: { agentId: string }) {
  const { startSession, endSession, status, isSpeaking } = useConversation();

  const handleToggleSession = async () => {
    if (status === 'connected') {
      endSession();
    } else {
      try {
        await startSession({ agentId });
      } catch (error) {
        console.error('Failed to start session:', error);
      }
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 p-4 bg-teal-50 rounded-xl border border-teal-100">
      <div className="text-center space-y-2">
        <h3 className="font-semibold text-teal-900 flex items-center justify-center gap-2">
          <Bot className="w-5 h-5 text-teal-600" />
          Assistente Virtual
        </h3>
        <p className="text-sm text-slate-600">
          Integração com ElevenLabs AI
        </p>
      </div>

      <div className="relative">
        <div className={`absolute inset-0 bg-teal-500 rounded-full blur-xl opacity-20 transition-all duration-500 ${isSpeaking ? 'scale-150 opacity-40' : 'scale-100'}`} />
        <Button
          onClick={handleToggleSession}
          disabled={status === 'connecting'}
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
      
      <div className="text-xs font-medium px-3 py-1 bg-white rounded-full border border-teal-200 text-teal-800">
        Status: {status === 'connected' ? 'Conectado' : status === 'connecting' ? 'Conectando...' : 'Desconectado'}
      </div>
      
      {status === 'connected' && (
        <div className="text-xs text-slate-500 animate-pulse">
          {isSpeaking ? 'O agente está falando...' : 'Ouvindo...'}
        </div>
      )}
    </div>
  );
}

export function ElevenLabsAgent({ agentId }: { agentId?: string }) {
  // Se não houver agentId, mostramos um aviso para configuração
  if (!agentId) {
    return (
      <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-center space-y-3">
        <Bot className="w-8 h-8 text-slate-400 mx-auto" />
        <h3 className="font-semibold text-slate-700">Agente ElevenLabs não configurado</h3>
        <p className="text-sm text-slate-500">
          Para ativar o assistente de voz, configure o <code className="bg-slate-200 px-1 py-0.5 rounded">Agent ID</code> do ElevenLabs no seu painel.
        </p>
      </div>
    );
  }

  return (
    <ConversationProvider>
      <AgentInner agentId={agentId} />
    </ConversationProvider>
  );
}
