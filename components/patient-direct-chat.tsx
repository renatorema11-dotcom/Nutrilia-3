'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, Input, Button } from '@/components/ui';
import { Send, User, Stethoscope, Loader2, MessageSquare } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { getUserData } from '@/lib/db';
import {
  DirectMessage,
  MAX_MESSAGE_LENGTH,
  formatMessageTime,
  sendDirectMessage,
  subscribeToDirectMessages
} from '@/lib/chat';

/** Conversa direta do paciente com a nutricionista dele: a mesma que ela vê em "Chat com Pacientes". */
export function PatientDirectChat() {
  const { user } = useAuth();
  const [nutritionist, setNutritionist] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    // O vínculo que vale é o do prontuário: é ele que o banco confere para liberar a conversa.
    getUserData(user.uid)
      .then((data) => {
        const id = data?.patientData?.nutritionistId;
        if (active && id) setNutritionist({ id, name: data.patientData.nutritionistName || 'Nutricionista' });
      })
      .catch((err) => {
        console.error('Erro ao carregar a nutricionista do paciente:', err);
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  const chatId = user?.uid && nutritionist ? `${user.uid}_${nutritionist.id}` : '';

  useEffect(() => {
    if (!chatId) return;
    setChatError('');
    return subscribeToDirectMessages(chatId, setMessages, () =>
      setChatError('Não foi possível carregar esta conversa. Recarregue a página e tente de novo.'));
  }, [chatId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !user?.uid || !chatId) return;

    const text = inputText.trim();
    setInputText('');
    setSending(true);
    setChatError('');
    try {
      await sendDirectMessage(chatId, user.uid, user.displayName || 'Paciente', 'patient', text);
    } catch (err) {
      console.error('Erro ao enviar mensagem:', err);
      // Devolve o texto ao campo: a mensagem não saiu e o paciente precisa saber.
      setInputText(text);
      setChatError('A mensagem não foi enviada. Tente de novo.');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <Card className="flex-1 flex items-center justify-center min-h-0">
        <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
      </Card>
    );
  }

  if (!nutritionist) {
    return (
      <Card className="flex-1 flex flex-col items-center justify-center min-h-0 p-8 text-center gap-3">
        <MessageSquare className="w-12 h-12 text-slate-300" />
        {loadError ? (
          <p role="alert" className="text-sm text-red-700">
            Não foi possível abrir a conversa agora. Recarregue a página e tente de novo.
          </p>
        ) : (
          <>
            <h3 className="text-base font-bold text-slate-800">Você ainda não escolheu quem vai acompanhar você</h3>
            <p className="text-sm text-slate-600 max-w-sm">
              Depois de escolher, a conversa com a pessoa aparece aqui.
            </p>
            <Link href="/patient/nutritionist">
              <Button className="bg-teal-700 hover:bg-teal-800 text-white">Escolher nutricionista</Button>
            </Link>
          </>
        )}
      </Card>
    );
  }

  return (
    <Card className="flex-1 flex flex-col min-h-0">
      <div className="p-3.5 px-4 sm:px-5 bg-gradient-to-r from-teal-800 to-emerald-800 text-white flex items-center gap-3 shrink-0">
        <div className="w-9 h-9 rounded-full bg-white/20 border border-white/40 flex items-center justify-center shrink-0">
          <Stethoscope className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <h3 className="font-bold text-sm leading-tight truncate">{nutritionist.name}</h3>
          <p className="text-[11px] text-teal-100 truncate">Responde quando estiver disponível</p>
        </div>
      </div>

      <CardContent className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
        {messages.length === 0 ? (
          <div className="py-12 text-center text-slate-500 space-y-2">
            <MessageSquare className="w-10 h-10 text-teal-600/40 mx-auto" />
            <p className="font-semibold text-sm text-slate-700">Nenhuma mensagem com {nutritionist.name} ainda.</p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Escreva abaixo para começar. Para dúvidas rápidas a qualquer hora, use a aba Assistente IA.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMine = msg.senderRole === 'patient';
            return (
              <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                <div className={`flex max-w-[85%] sm:max-w-[80%] ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div
                    className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
                      isMine ? 'bg-teal-700 text-white ml-2.5' : 'bg-slate-200 text-slate-700 mr-2.5'
                    }`}
                  >
                    {isMine ? <User className="h-4 w-4" /> : <Stethoscope className="h-4 w-4" />}
                  </div>
                  <div
                    className={`p-3.5 rounded-2xl text-sm shadow-sm ${
                      isMine
                        ? 'bg-teal-700 text-white rounded-tr-none'
                        : 'bg-white text-slate-800 border border-slate-200/80 rounded-tl-none'
                    }`}
                  >
                    {!isMine && <p className="text-[10px] font-bold opacity-75 mb-0.5">{msg.senderName}</p>}
                    <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.text}</p>
                    <p className={`text-[9px] mt-1 text-right ${isMine ? 'text-teal-200' : 'text-slate-400'}`}>
                      {formatMessageTime(msg.createdAt)}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </CardContent>

      <div className="p-3.5 bg-white border-t border-slate-100">
        {chatError && <p role="alert" className="mb-2 text-sm text-red-700">{chatError}</p>}
        <form onSubmit={handleSend} className="flex gap-2">
          <Input
            id="direct-chat-input"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={`Escreva para ${nutritionist.name}...`}
            maxLength={MAX_MESSAGE_LENGTH}
            className="flex-1"
          />
          <Button
            type="submit"
            disabled={sending || !inputText.trim()}
            className="bg-teal-700 hover:bg-teal-800 text-white px-5"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </Card>
  );
}
