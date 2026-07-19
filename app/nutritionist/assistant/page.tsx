'use client';

import { useState, useRef, useEffect } from 'react';
import { Card, CardContent, Input, Button } from '@/components/ui';
import { MOCK_PATIENTS_LIST } from '@/lib/mock-data';
import { Send, Sparkles, UserRound } from 'lucide-react';

interface Message {
  role: 'user' | 'ai';
  text: string;
}

export default function NutritionistAssistant() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'ai', text: 'Olá, Dra. Ana! Sou seu assistente clínico. Posso resumir casos, buscar pacientes parados ou ajudar a revisar protocolos.' }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
      // Dump patients list as context
      const context = JSON.stringify(MOCK_PATIENTS_LIST.map(p => ({
        nome: p.name,
        idade: p.age,
        temPlano: !!p.currentPlan,
        statusPlano: p.currentPlan?.status,
        proximaConsulta: p.nextAppointment
      })));

      const res = await fetch('/api/gemini/chat/nutritionist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, { role: 'user', text: userMessage }],
          context
        })
      });
      
      const data = await res.json();
      
      if (data.text) {
        setMessages(prev => [...prev, { role: 'ai', text: data.text }]);
      }
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { role: 'ai', text: 'Erro ao processar solicitação.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Assistente IA Clínico</h1>
        <p className="text-gray-600 mb-6">Seu co-piloto para análise de dados dos pacientes.</p>
      </div>

      <Card className="flex-1 flex flex-col min-h-0 border-emerald-100 shadow-sm">
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`flex max-w-[80%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center ${msg.role === 'user' ? 'bg-gray-100 ml-3' : 'bg-emerald-100 mr-3'}`}>
                  {msg.role === 'user' ? <UserRound className="h-5 w-5 text-gray-600" /> : <Sparkles className="h-5 w-5 text-emerald-600" />}
                </div>
                <div className={`p-3 rounded-lg ${msg.role === 'user' ? 'bg-gray-900 text-white' : 'bg-emerald-50 text-gray-800 border border-emerald-100'}`}>
                  <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
                </div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="flex max-w-[80%] flex-row">
                <div className="flex-shrink-0 h-8 w-8 rounded-full bg-emerald-100 mr-3 flex items-center justify-center">
                  <Sparkles className="h-5 w-5 text-emerald-600" />
                </div>
                <div className="p-3 rounded-lg bg-emerald-50 text-gray-800 border border-emerald-100 flex items-center space-x-2">
                  <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                  <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </CardContent>
        <div className="p-4 border-t border-gray-100 bg-gray-50 rounded-b-xl">
          <form onSubmit={handleSend} className="flex gap-2">
            <Input
              id="assistant-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Pergunte sobre seus pacientes, peça resumos..."
              className="flex-1 bg-white"
            />
            <Button type="submit" disabled={isLoading || !input.trim()} className="bg-gray-900 hover:bg-gray-800">
              <Send className="h-5 w-5" />
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}
