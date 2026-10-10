'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
import { auth } from '@/lib/firebase';
import { describeAttendance, describeClinic, type AliSettings } from '@/lib/ali-settings';

const AGENT_ID = 'agent_4901kze5k1xhe5590n67kh1pby82';

/**
 * Botão flutuante da Ali no painel da nutricionista: funciona como prévia da Ali dela,
 * com as mesmas variáveis que os pacientes recebem (sem dados de paciente).
 */
export function NutritionistAliWidget({ hideOnMobile }: { hideOnMobile: boolean }) {
  const [variables, setVariables] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      let settings: AliSettings | null = null;
      try {
        const token = await auth.currentUser?.getIdToken();
        if (token) {
          const res = await fetch('/api/nutritionist/ali-settings', { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
          if (res.ok) settings = (await res.json()).settings;
        }
      } catch { /* usa os valores padrão */ }
      if (cancelled) return;
      setVariables(JSON.stringify({
        patientFirstName: 'tudo bem',
        patientName: '',
        patientUid: '',
        secret__patientToken: '',
        nutritionistName: settings?.displayName || 'sua nutricionista',
        attendanceInfo: settings ? describeAttendance(settings) : 'Horários de atendimento não informados.',
        clinicInfo: (settings && describeClinic(settings)) || 'Nenhuma informação do consultório cadastrada.',
        nutritionistGuidelines: settings?.guidelines || 'Nenhuma orientação adicional.',
        agendaStatus: 'nao_conectada',
      }));
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (!variables) return null;
  return (
    <>
      <Script src="https://unpkg.com/@elevenlabs/convai-widget-embed" strategy="lazyOnload" />
      {/* @ts-ignore - Custom Web Component from ElevenLabs */}
      <elevenlabs-convai agent-id={AGENT_ID} dynamic-variables={variables} className={hideOnMobile ? 'convai-hide-mobile' : undefined}></elevenlabs-convai>
    </>
  );
}
