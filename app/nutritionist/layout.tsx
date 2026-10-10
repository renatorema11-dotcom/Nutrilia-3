'use client';

import { useAuth } from '@/components/auth-provider';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { LayoutDashboard, Users, MessageSquareText, MessageSquare, User, Bot } from 'lucide-react';
import { AppShell, AppLoading, type NavItem } from '@/components/app-shell';
import { NutritionistAliWidget } from '@/components/nutritionist-ali-widget';

const navigation: NavItem[] = [
  { name: 'Dashboard', shortName: 'Início', href: '/nutritionist', icon: LayoutDashboard, inBottomBar: true },
  { name: 'Pacientes', shortName: 'Pacientes', href: '/nutritionist/patients', icon: Users, inBottomBar: true },
  { name: 'Chat com Pacientes', shortName: 'Chat', href: '/nutritionist/chat', icon: MessageSquare, inBottomBar: true },
  { name: 'Assistente IA', shortName: 'Assistente', href: '/nutritionist/assistant', icon: MessageSquareText, inBottomBar: true },
  { name: 'Minha Ali', shortName: 'Minha Ali', href: '/nutritionist/ali', icon: Bot },
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

  // Nas telas com campo de digitação, o botão flutuante cobriria os campos no celular.
  const hideWidgetOnMobile = ['/nutritionist/chat', '/nutritionist/assistant', '/nutritionist/ali'].some((p) => pathname.startsWith(p));

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

      {/* ElevenLabs: prévia da Ali com as configurações desta nutricionista */}
      <NutritionistAliWidget hideOnMobile={hideWidgetOnMobile} />
    </>
  );
}
