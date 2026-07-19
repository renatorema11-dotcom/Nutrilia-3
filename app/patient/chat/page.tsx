'use client';

import { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Input, Button } from '@/components/ui';
import { MOCK_PATIENT } from '@/lib/mock-data';
import { Send, Bot, User } from 'lucide-react';

interface Message {
  role: 'user' | 'ai';
  text: string;
}

export default function PatientChat() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'ai', text: 'Olá! Sou seu assistente nutricional. Como posso ajudar com seu plano alimentar hoje?' }
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
      // Build context string from mock data
      const context = `Plano atual: ${JSON.stringify(MOCK_PATIENT.currentPlan?.days)}. Peso atual: ${MOCK_PATIENT.measurements[MOCK_PATIENT.measurements.length - 1].weight}kg.`;

      const res = await fetch('/api/gemini/chat/patient', {
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
