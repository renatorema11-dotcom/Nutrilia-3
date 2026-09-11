'use client';

import { useState, useEffect } from 'react';
import { useAuth } from './auth-provider';
import { getUserData, updateUserData } from '@/lib/db';
import { Sparkles, X, ChevronRight, ChevronLeft, Check } from 'lucide-react';

interface TourStep {
  target?: string;
  title: string;
  content: string;
  placement?: 'center' | 'bottom' | 'top' | 'left' | 'right';
}

const STEPS: TourStep[] = [
  {
    title: 'Bem-vindo(a) ao seu Painel NutriAli!',
    content: 'Preparamos um tour rápido de 1 minuto para você conhecer os recursos essenciais do seu acompanhamento nutricional inteligente.',
    placement: 'center',
  },
  {
    target: '.tour-plan-generator',
    title: 'Gerador Criativo de Cardápios com IA',
    content: 'Nesta área, você pode gerar ideias criativas de planos e receitas com auxílio do Gemini, totalmente alinhadas aos seus objetivos e preferências!',
    placement: 'bottom',
  },
  {
    target: '.tour-chat',
    title: 'Apoio Nutricional e Chat 24/7',
    content: 'Ficou com dúvidas sobre o cardápio ou quer trocar um alimento? Nosso chat está sempre disponível para orientações e suporte contínuo.',
    placement: 'left',
  },
  {
    target: '.tour-evolution',
    title: 'Evolução e Metas Corporais',
    content: 'Acompanhe seus registros de peso, medidas corporais, hidratação e adesão alimentar em gráficos interativos e claros.',
    placement: 'top',
  },
];

export function GuidedTour() {
  const [run, setRun] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const { user } = useAuth();

  useEffect(() => {
    async function checkTour() {
      if (user) {
        try {
          const data = await getUserData(user.uid);
          if (!data?.hasSeenTour) {
            const timer = setTimeout(() => setRun(true), 1200);
            return () => clearTimeout(timer);
          }
        } catch (err) {
          console.warn('Erro ao verificar tour do usuário:', err);
        }
      } else {
        const hasSeenTour = localStorage.getItem('hasSeenTour');
        if (!hasSeenTour) {
          const timer = setTimeout(() => setRun(true), 1200);
          return () => clearTimeout(timer);
        }
      }
    }
    checkTour();
  }, [user]);

  // Scroll to targeted element when step changes
  useEffect(() => {
    if (!run) return;
    const step = STEPS[currentStep];
    if (step.target) {
      const el = document.querySelector(step.target);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('tour-highlight-active');
        return () => {
          el.classList.remove('tour-highlight-active');
        };
      }
    }
  }, [run, currentStep]);

  const handleFinish = async () => {
    setRun(false);
    if (user) {
      try {
        await updateUserData(user.uid, { hasSeenTour: true });
      } catch (e) {
        console.warn('Não foi possível salvar status do tour:', e);
      }
    }
    localStorage.setItem('hasSeenTour', 'true');
  };

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      handleFinish();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  if (!run) return null;

  const step = STEPS[currentStep];
  const isLast = currentStep === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Semi-transparent backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-[2px] transition-opacity duration-300"
        onClick={handleFinish}
        aria-hidden="true"
      />

      {/* Tour Card */}
      <div className="relative z-10 w-full max-w-md bg-white rounded-2xl shadow-2xl border border-teal-100 p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-teal-50 text-teal-700">
              <Sparkles className="w-5 h-5 text-teal-600" />
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-teal-700 bg-teal-50 px-2.5 py-0.5 rounded-full border border-teal-200/60">
              Passo {currentStep + 1} de {STEPS.length}
            </span>
          </div>
          <button
            onClick={handleFinish}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
            title="Fechar tour"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div>
          <h3 className="text-lg font-bold text-slate-900">{step.title}</h3>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed">{step.content}</p>
        </div>

        {/* Step Progress Dots */}
        <div className="flex items-center gap-1.5 pt-1">
          {STEPS.map((_, idx) => (
            <div
              key={idx}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                idx === currentStep ? 'w-6 bg-teal-600' : 'w-2 bg-slate-200'
              }`}
            />
          ))}
        </div>

        {/* Navigation Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <button
            onClick={handleFinish}
            className="text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors"
          >
            Pular tour
          </button>

          <div className="flex items-center gap-2">
            {currentStep > 0 && (
              <button
                onClick={handlePrev}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Voltar
              </button>
            )}
            <button
              onClick={handleNext}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors shadow-sm"
            >
              {isLast ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Concluir
                </>
              ) : (
                <>
                  Próximo
                  <ChevronRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
