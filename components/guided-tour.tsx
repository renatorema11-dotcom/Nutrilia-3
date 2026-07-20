'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui';
import { X, Sparkles, MessageSquare, LineChart, Info } from 'lucide-react';

export function GuidedTour() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const hasSeenTour = localStorage.getItem('hasSeenTour');
    if (!hasSeenTour) {
      // Small delay to let the page render first
      const timer = setTimeout(() => setIsOpen(true), 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  const closeTour = () => {
    setIsOpen(false);
    localStorage.setItem('hasSeenTour', 'true');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-300">
        <div className="p-6 border-b border-slate-100 flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center">
              <Info className="w-5 h-5 text-teal-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-800">Bem-vindo(a) ao seu Painel!</h2>
          </div>
          <button 
            onClick={closeTour}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6 space-y-6">
          <p className="text-sm text-slate-600">
            Aqui estão os principais recursos para te ajudar a alcançar seu objetivo:
          </p>
          
          <div className="space-y-4">
            <div className="flex gap-4 items-start">
              <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-800">Cardápio Inteligente</h3>
                <p className="text-sm text-slate-500 leading-relaxed">
                  Gere ideias criativas de cardápios personalizados pelo nosso assistente de IA, baseados no seu objetivo e medidas.
                </p>
              </div>
            </div>

            <div className="flex gap-4 items-start">
              <div className="w-10 h-10 rounded-full bg-purple-50 flex items-center justify-center shrink-0">
                <MessageSquare className="w-5 h-5 text-purple-500" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-800">Chat IA 24/7</h3>
                <p className="text-sm text-slate-500 leading-relaxed">
                  Tire dúvidas rápidas sobre nutrição ou receba apoio motivacional a qualquer momento.
                </p>
              </div>
            </div>

            <div className="flex gap-4 items-start">
              <div className="w-10 h-10 rounded-full bg-teal-50 flex items-center justify-center shrink-0">
                <LineChart className="w-5 h-5 text-teal-500" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-800">Gráfico de Evolução</h3>
                <p className="text-sm text-slate-500 leading-relaxed">
                  Acompanhe seu progresso de peso e gordura corporal diretamente na visão geral.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
          <Button onClick={closeTour} className="w-full">
            Começar a explorar
          </Button>
        </div>
      </div>
    </div>
  );
}
