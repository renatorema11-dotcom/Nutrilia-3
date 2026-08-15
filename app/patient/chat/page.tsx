'use client';

import { useState, useRef, useEffect } from 'react';
import { Card, CardContent, Input, Button } from '@/components/ui';
import { Send, Bot, User } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { getUserData } from '@/lib/db';

interface Message {
  role: 'user' | 'ai';
  text: string;
}

export default function PatientChat() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([
    { role: 'ai', text: 'Olá! Sou seu assistente nutricional com Inteligência Artificial. Como posso ajudar com seu plano alimentar hoje?' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [patientContext, setPatientContext] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadContext() {
      let weight = 70;
      let objective = 'Alimentação Saudável';

      if (user) {
        const data = await getUserData(user.uid);
        if (data?.patientData) {
          weight = data.patientData.weight || 70;
          objective = data.patientData.objective || objective;
        }
      } else {
        const saved = localStorage.getItem('mockPatientData');
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            weight = parsed.weight || 70;
            objective = parsed.objective || objective;
          } catch {
            // ignore
          }
        }
      }

      setPatientContext(`Peso do paciente: ${weight}kg. Objetivo: ${objective}.`);
    }
    loadContext();
  }, [user]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', text: userMessage }]);
    setIsLoading(true);

    try {
      const res = await fetch('/api/gemini/chat/patient', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, { role: 'user', text: userMessage }],
          context: patientContext
        })
      });

      const data = await res.json();

      if (data.text) {
        setMessages(prev => [...prev, { role: 'ai', text: data.text }]);
      }
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'ai', text: 'Desculpe, ocorreu um erro ao tentar responder. Tente novamente.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Chat Nutri IA</h1>
        <p className="text-gray-600 mb-6">Tire dúvidas rápidas sobre sua alimentação.</p>
      </div>

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
    </div>
  );
}
