'use client';

import { useAuth } from '@/components/auth-provider';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { LayoutDashboard, FileText, Activity, MessageSquare, User, Stethoscope } from 'lucide-react';
import { AppShell, AppLoading, type NavItem } from '@/components/app-shell';

const navigation: NavItem[] = [
  { name: 'Dashboard', shortName: 'Início', href: '/patient', icon: LayoutDashboard, inBottomBar: true },
  { name: 'Meu Plano', shortName: 'Plano', href: '/patient/plan', icon: FileText, inBottomBar: true },
  { name: 'Meus Dados', shortName: 'Dados', href: '/patient/data', icon: Activity, inBottomBar: true },
  { name: 'Meu Nutricionista', shortName: 'Nutri', href: '/patient/nutritionist', icon: Stethoscope, inBottomBar: true },
  { name: 'Chat Nutri IA', shortName: 'Chat', href: '/patient/chat', icon: MessageSquare, inBottomBar: true },
  { name: 'Meu Perfil', shortName: 'Perfil', href: '/patient/profile', icon: User },
];

export default function PatientLayout({ children }: { children: React.ReactNode }) {
  const { role, user, logout, ready } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Só decide depois que o Firebase confirmar a sessão; antes disso o papel ainda está carregando.
    if (ready && role !== 'patient') {
      router.replace('/login');
    }
  }, [ready, role, router]);

  if (!ready) return <AppLoading />;
  if (role !== 'patient') return null;

  return (
    <AppShell
      navigation={navigation}
      isActive={(href) => pathname === href}
      user={user}
      fallbackName="Paciente"
      onLogout={logout}
    >
      {children}
    </AppShell>
  );
}
