'use client';

import { useAuth } from '@/components/auth-provider';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LayoutDashboard, Users, MessageSquareText, MessageSquare, User, Bot, ShieldCheck } from 'lucide-react';
import { AppShell, AppLoading, type NavItem } from '@/components/app-shell';
import { NutritionistAliAssistant } from '@/components/nutritionist-ali-assistant';
import { NutritionistPending } from '@/components/nutritionist-pending';
import { NutritionistTour } from '@/components/nutritionist-tour';
import { authFetch } from '@/lib/api-client';

const navigation: NavItem[] = [
  { name: 'Dashboard', shortName: 'Início', href: '/nutritionist', icon: LayoutDashboard, inBottomBar: true },
  { name: 'Pacientes', shortName: 'Pacientes', href: '/nutritionist/patients', icon: Users, inBottomBar: true },
  { name: 'Chat com Pacientes', shortName: 'Chat', href: '/nutritionist/chat', icon: MessageSquare, inBottomBar: true },
  { name: 'Assistente IA', shortName: 'Assistente', href: '/nutritionist/assistant', icon: MessageSquareText, inBottomBar: true },
  { name: 'Minha Ali', shortName: 'Minha Ali', href: '/nutritionist/ali', icon: Bot },
  { name: 'Meu Perfil', shortName: 'Perfil', href: '/nutritionist/profile', icon: User, inBottomBar: true },
];

export default function NutritionistLayout({ children }: { children: React.ReactNode }) {
  const { role, user, logout, ready, approval } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  // Só o responsável pelo NutriAli vê o item "Aprovações" (quem decide isso é o servidor).
  const [pendingApprovals, setPendingApprovals] = useState<number | null>(null);
  const active = ready && role === 'nutritionist' && approval === 'approved' && !!user;

  useEffect(() => {
    if (!active) return;
    let current = true;
    authFetch('/api/admin/approvals?resumo=1', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (current && data?.admin === true) setPendingApprovals(typeof data.pending === 'number' ? data.pending : 0); })
      .catch(() => {});
    return () => { current = false; };
  }, [active]);

  useEffect(() => {
    // Só decide depois que o Firebase confirmar a sessão; antes disso o papel ainda está carregando.
    if (ready && role !== 'nutritionist') {
      router.replace('/login');
    }
  }, [ready, role, router]);

  if (!ready) return <AppLoading />;
  if (role !== 'nutritionist') return null;
  // Cadastro em análise (ou recusado): nenhuma tela de nutricionista abre antes da aprovação.
  if (approval !== 'approved') return <NutritionistPending />;

  const items: NavItem[] = pendingApprovals === null ? navigation : [
    ...navigation,
    { name: pendingApprovals ? `Aprovações (${pendingApprovals})` : 'Aprovações', shortName: 'Aprovações', href: '/admin/aprovacoes', icon: ShieldCheck },
  ];

  // Nas telas com campo de digitação, o botão flutuante cobriria os campos no celular.
  const hideWidgetOnMobile = ['/nutritionist/chat', '/nutritionist/assistant', '/nutritionist/ali'].some((p) => pathname.startsWith(p));

  return (
    <>
      <AppShell
        navigation={items}
        isActive={(href) => pathname === href || (href !== '/nutritionist' && pathname.startsWith(`${href}/`))}
        user={user}
        fallbackName="Nutricionista"
        onLogout={logout}
      >
        {children}
      </AppShell>

      {/* Tour de boas-vindas: uma vez, na primeira entrada no painel. */}
      {pathname === '/nutritionist' && <NutritionistTour />}

      {/* Ali da nutricionista: pacientes, agenda e e-mails dela, por voz ou por texto */}
      <NutritionistAliAssistant hideOnMobile={hideWidgetOnMobile} />
    </>
  );
}
