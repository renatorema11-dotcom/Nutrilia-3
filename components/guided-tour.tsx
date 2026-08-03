'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Step } from 'react-joyride';
import { useAuth } from './auth-provider';
import { getUserData, updateUserData } from '@/lib/db';

// Dynamically import Joyride to avoid SSR issues
const Joyride = dynamic(() => import('react-joyride').then((mod) => mod.Joyride), { ssr: false });

export function GuidedTour() {
  const [run, setRun] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    async function checkTour() {
      if (user) {
        const data = await getUserData(user.uid);
        if (!data?.hasSeenTour) {
          const timer = setTimeout(() => setRun(true), 1000);
          return () => clearTimeout(timer);
        }
      } else {
        const hasSeenTour = localStorage.getItem('hasSeenTour');
        if (!hasSeenTour) {
          const timer = setTimeout(() => setRun(true), 1000);
          return () => clearTimeout(timer);
        }
      }
    }
    checkTour();
  }, [user]);

  const handleJoyrideCallback = async (data: any) => {
    const { status } = data;
    const finishedStatuses: string[] = ['finished', 'skipped'];
    if (finishedStatuses.includes(status)) {
      setRun(false);
      if (user) {
        await updateUserData(user.uid, { hasSeenTour: true });
      } else {
        localStorage.setItem('hasSeenTour', 'true');
      }
    }
  };

  const steps: Step[] = [
    {
      target: 'body',
      content: 'Bem-vindo(a) ao seu Painel! Vamos fazer um tour rápido para você conhecer os principais recursos.',
      placement: 'center',
      skipBeacon: true,
    },
    {
      target: '.tour-plan-generator',
      content: 'Nesta área, você pode gerar ideias criativas de cardápios com a ajuda da nossa Inteligência Artificial, sempre focados no seu objetivo!',
      placement: 'bottom',
    },
    {
      target: '.tour-chat',
      content: 'Tem dúvidas ou precisa de apoio? Nosso chat está disponível 24/7 para te ajudar.',
      placement: 'left',
    },
    {
      target: '.tour-evolution',
      content: 'Acompanhe seu progresso de peso e gordura corporal por este gráfico interativo.',
      placement: 'top',
    }
  ];

  return (
    <Joyride
      steps={steps}
      run={run}
      continuous
      scrollToFirstStep
      onEvent={handleJoyrideCallback}
      options={{
        primaryColor: '#0d9488', // teal-600
        showProgress: true,
        buttons: ['back', 'close', 'primary', 'skip'],
      }}
      locale={{
        back: 'Voltar',
        close: 'Fechar',
        last: 'Finalizar',
        next: 'Próximo',
        skip: 'Pular',
      }}
    />
  );
}
