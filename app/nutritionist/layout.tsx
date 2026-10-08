'use client';

import { useAuth } from '@/components/auth-provider';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { LayoutDashboard, Users, MessageSquareText, MessageSquare, User } from 'lucide-react';
import Script from 'next/script';
import { AppShell, AppLoading, type NavItem } from '@/components/app-shell';

const navigation: NavItem[] = [
  { name: 'Dashboard', shortName: 'Início', href: '/nutritionist', icon: LayoutDashboard, inBottomBar: true },
  { name: 'Pacientes', shortName: 'Pacientes', href: '/nutritionist/patients', icon: Users, inBottomBar: true },
  { name: 'Chat com Pacientes', shortName: 'Chat', href: '/nutritionist/chat', icon: MessageSquare, inBottomBar: true },
  { name: 'Assistente IA', shortName: 'Assistente', href: '/nutritionist/assistant', icon: MessageSquareText, inBottomBar: true },
  { name: 'Meu Perfil', shortName: 'Perfil', href: '/nutritionist/profile', icon: User, inBottomBar: true },
];

export default function NutritionistLayout({ children }: { children: React.ReactNode }) {
  const { role, user, logout, ready } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Só decide depois que o Firebase confirmar a sessão; antes disso o papel ainda está carregando.
    if (ready && role !== 'nutritionist') {
      router.replace('/login');
    }
  }, [ready, role, router]);

  if (!ready) return <AppLoading />;
  if (role !== 'nutritionist') return null;

  // Nas telas com campo de mensagem embaixo, o botão flutuante cobriria o campo no celular.
  const hideWidgetOnMobile = pathname.startsWith('/nutritionist/chat') || pathname.startsWith('/nutritionist/assistant');

  return (
    <>
      <AppShell
        navigation={navigation}
        isActive={(href) => pathname === href || (href !== '/nutritionist' && pathname.startsWith(`${href}/`))}
        user={user}
        fallbackName="Nutricionista"
        onLogout={logout}
      >
        {children}
      </AppShell>

      {/* ElevenLabs Conversational Widget */}
      <Script src="https://unpkg.com/@elevenlabs/convai-widget-embed" strategy="lazyOnload" />
      {/* @ts-ignore - Custom Web Component from ElevenLabs */}
      <elevenlabs-convai agent-id="agent_4901kze5k1xhe5590n67kh1pby82" className={hideWidgetOnMobile ? 'convai-hide-mobile' : undefined}></elevenlabs-convai>
    </>
  );
}
