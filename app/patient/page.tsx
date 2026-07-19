'use client';

import { MOCK_PATIENT } from '@/lib/mock-data';
import { Card, CardContent, CardHeader, CardTitle, Button } from '@/components/ui';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Calendar, MessageSquare, Apple, Sparkles, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';

export default function PatientDashboard() {
  const [patientData, setPatientData] = useState<any>(null);
  const [creativePlan, setCreativePlan] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('mockPatientData');
    if (saved) {
      setPatientData(JSON.parse(saved));
    } else {
      setPatientData({
        name: MOCK_PATIENT.name,
        age: 32,
        weight: 70,
        height: 165,
        objective: 'Manutenção'
      });
    }
  }, []);

  const nextAppointment = parseISO(MOCK_PATIENT.nextAppointment);

  const generateCreativePlan = async () => {
    if (!patientData) return;
    setIsGenerating(true);
    try {
      const res = await fetch('/api/gemini/generate-creative-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patientData)
      });
      const data = await res.json();
      if (data.text) {
        setCreativePlan(data.text);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsGenerating(false);
    }
  };

  if (!patientData) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-slate-800">Olá, {patientData.name.split(' ')[0]}</h1>
        <p className="text-slate-600">Bem-vindo(a) de volta ao seu painel.</p>
        
        <div className="flex gap-4 mt-2">
          <span className="text-xs font-semibold bg-white/40 border border-white/50 text-slate-700 px-3 py-1 rounded-full shadow-sm">Objetivo: {patientData.objective}</span>
          <span className="text-xs font-semibold bg-white/40 border border-white/50 text-slate-700 px-3 py-1 rounded-full shadow-sm">Peso: {patientData.weight}kg</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2 flex flex-col gap-4">
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center text-teal-800">
              <Sparkles className="w-5 h-5 mr-2 text-teal-600" />
              Ideias Criativas com IA
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-slate-600 mb-4 text-sm">
              Que tal fugir da rotina? Peça para nossa Inteligência Artificial criar um cardápio diário inovador, totalmente focado no seu objetivo de <strong>{patientData.objective}</strong>!
            </p>
            
            {!creativePlan && !isGenerating && (
              <Button onClick={generateCreativePlan} className="bg-teal-600 hover:bg-teal-700 text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                Gerar Cardápio Criativo
              </Button>
            )}

            {isGenerating && (
              <div className="flex items-center gap-2 text-teal-600 text-sm font-semibold">
                <Loader2 className="w-4 h-4 animate-spin" />
                Criando um cardápio incrível...
              </div>
            )}

            {creativePlan && !isGenerating && (
              <div className="mt-4 bg-white/50 border border-white/60 p-4 rounded-xl">
                <div className="markdown-body text-sm text-slate-700 space-y-4">
                  <Markdown>{creativePlan}</Markdown>
                </div>
                <Button onClick={generateCreativePlan} variant="outline" className="mt-4 text-xs h-8">
                  Gerar outra opção
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center text-base">
                <Calendar className="w-5 h-5 mr-2 text-blue-500" />
                Próxima Consulta
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-slate-800">
                {format(nextAppointment, "dd 'de' MMM", { locale: ptBR })}
              </p>
              <p className="text-slate-600 capitalize">
                {format(nextAppointment, "EEEE 'às' HH:mm", { locale: ptBR })}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center shadow-sm">
                  <MessageSquare className="w-6 h-6 text-purple-600" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800">Dúvidas?</h3>
                  <p className="text-sm text-slate-600 mt-1">Converse com nosso assistente sobre seu progresso.</p>
                </div>
                <Link href="/patient/chat" className="w-full">
                  <Button variant="outline" className="w-full bg-white/40">Abrir Chat</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
