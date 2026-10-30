'use client';

import { useState, useRef, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, Input, Button } from '@/components/ui';
import { Send, Bot, User, Stethoscope, Loader2 } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { getUserData } from '@/lib/db';
import { ApiError, postJson } from '@/lib/api-client';
import { ElevenLabsAgent } from '@/components/elevenlabs-agent';
import { PatientDirectChat } from '@/components/patient-direct-chat';
import { useNutriUnread } from '@/components/nutri-notices';

interface Message {
  role: 'user' | 'ai';
  text: string;
  /** Aviso de falha mostrado na conversa; não entra no histórico enviado à IA. */
  error?: boolean;
}

type ChatTab = 'ai' | 'nutritionist';

const tabs: { id: ChatTab; label: string; icon: typeof Bot }[] = [
  { id: 'ai', label: 'Assistente IA', icon: Bot },
  { id: 'nutritionist', label: 'Nutricionista', icon: Stethoscope },
];

function PatientChatContent() {
  const { user } = useAuth();
  const router = useRouter();
  // "?tab=nutritionist" abre direto a conversa com a nutricionista (é o endereço do botão em "Meu Nutricionista").
  const tab: ChatTab = useSearchParams().get('tab') === 'nutritionist' ? 'nutritionist' : 'ai';
  const [messages, setMessages] = useState<Message[]>([
    { role: 'ai', text: 'Olá! Sou seu assistente nutricional com Inteligência Artificial. Como posso ajudar com seu plano alimentar hoje?' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [patientContext, setPatientContext] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { unread } = useNutriUnread();

  useEffect(() => {
    async function loadContext() {
      if (!user) return;
      // Só entra no contexto o que está de fato no prontuário: nada de valores de exemplo.
      const data = await getUserData(user.uid);
      const patient = data?.patientData || {};
      const lines: string[] = [];
      if (patient.objective) lines.push(`Objetivo: ${patient.objective}.`);
      if (patient.weight) lines.push(`Peso atual: ${patient.weight} kg.`);
      if (patient.targetWeight) lines.push(`Meta de peso: ${patient.targetWeight} kg.`);
      const days = Array.isArray(data?.currentPlan?.days) ? data.currentPlan.days : [];
      if (days.length) {
        lines.push('Plano alimentar atual, aprovado pela nutricionista:');
        for (const day of days) {
          lines.push(`${day.name}:`);
          for (const meal of day.meals || []) {
            lines.push(`- ${meal.time} ${meal.name}: ${Array.isArray(meal.items) ? meal.items.join(', ') : meal.items}`);
          }
        }
      } else {
        lines.push('O paciente ainda não tem plano alimentar aprovado pela nutricionista.');
      }
      setPatientContext(lines.join('\n').slice(0, 5000));
    }
    loadContext();
  }, [user]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, tab]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setIsLoading(true);

    try {
      const data = await postJson('/api/gemini/chat/patient', {
        messages: [...messages, { role: 'user', text: userMessage }],
        context: patientContext
      });

      if (data.text) {
        setMessages(prev => [...prev, { role: 'ai', text: data.text }]);
      }
    } catch (error) {
      console.error(error);
      // error: true deixa o aviso fora do histórico enviado à IA nas próximas perguntas.
      setMessages(prev => [...prev, { role: 'ai', text: error instanceof ApiError ? error.message : 'Desculpe, ocorreu um erro ao tentar responder. Tente novamente.', error: true }]);
    } finally {
      setIsLoading(false);
    }
  };

  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;

  return (
    <div className="h-[calc(100dvh-var(--app-chrome))] lg:h-[calc(100vh-8rem)] flex flex-col gap-4 lg:gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Chat</h1>
          <p className="hidden sm:block text-gray-600">
            {tab === 'ai' ? 'Tire dúvidas rápidas sobre sua alimentação.' : 'Fale direto com quem acompanha você.'}
          </p>
        </div>
        <div role="tablist" aria-label="Com quem conversar" className="flex bg-white/50 p-1 rounded-lg border border-white/60 w-full sm:w-auto">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => router.replace(id === 'ai' ? '/patient/chat' : '/patient/chat?tab=nutritionist')}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === id ? 'bg-white shadow-sm text-teal-700' : 'text-slate-600 hover:text-slate-900'}`}
            >
              <Icon className="w-4 h-4" />
              {label}
              {id === 'nutritionist' && tab !== 'nutritionist' && unread > 0 && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-teal-600 px-1.5 text-[11px] font-bold text-white" aria-label={`${unread} mensagens novas`}>{unread}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {tab === 'nutritionist' ? (
        <PatientDirectChat />
      ) : (
      /* No celular: Ali em cima e a conversa ocupando o resto da tela. */
      <div className="flex-1 min-h-0 flex flex-col gap-4 lg:grid lg:grid-cols-[1fr_320px] lg:gap-6">
      <Card className="flex-1 flex flex-col min-h-0">
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`flex max-w-[80%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${msg.role === 'user' ? 'bg-emerald-100 ml-3' : 'bg-purple-100 mr-3'}`}>
                  {msg.role === 'user' ? <User className="h-5 w-5 text-emerald-600" /> : <Bot className="h-5 w-5 text-purple-600" />}
                </div>
                <div className={`p-3 rounded-lg ${msg.role === 'user' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-800'}`}>
                  <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                </div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="flex max-w-[80%] flex-row">
                <div className="flex-shrink-0 h-8 w-8 rounded-full bg-purple-100 mr-3 flex items-center justify-center">
                  <Bot className="h-5 w-5 text-purple-600" />
                </div>
                <div className="p-3 rounded-lg bg-gray-100 text-gray-800 flex items-center space-x-2">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </CardContent>
        <div className="p-4 border-t border-gray-100">
          <form onSubmit={handleSend} className="flex gap-2">
            <Input
              id="chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Digite sua dúvida..."
              className="flex-1"
            />
            <Button type="submit" disabled={isLoading || !input.trim()}>
              <Send className="h-5 w-5" />
            </Button>
          </form>
        </div>
      </Card>

      <div className="order-first lg:order-none lg:min-h-0">
        <ElevenLabsAgent
          agentId={agentId}
          dynamicVariables={{
            patientUid: user?.uid || '',
            patientName: user?.displayName || '',
          }}
        />
      </div>
      </div>
      )}
    </div>
  );
}

export default function PatientChat() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
      </div>
    }>
      <PatientChatContent />
    </Suspense>
  );
}
