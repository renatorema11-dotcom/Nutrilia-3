'use client';

import { useAuth } from '@/components/auth-provider';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { LayoutDashboard, FileText, Activity, MessageSquare, User, Stethoscope } from 'lucide-react';
import { AppShell, AppLoading, type NavItem } from '@/components/app-shell';
import { postJson } from '@/lib/api-client';
import { ConsentGate } from '@/components/consent-gate';

const navigation: NavItem[] = [
  { name: 'Dashboard', shortName: 'Início', href: '/patient', icon: LayoutDashboard, inBottomBar: true },
  { name: 'Meu Plano', shortName: 'Plano', href: '/patient/plan', icon: FileText, inBottomBar: true },
  { name: 'Meus Dados', shortName: 'Dados', href: '/patient/data', icon: Activity, inBottomBar: true },
  { name: 'Meu Nutricionista', shortName: 'Nutri', href: '/patient/nutritionist', icon: Stethoscope, inBottomBar: true },
  { name: 'Chat', shortName: 'Chat', href: '/patient/chat', icon: MessageSquare, inBottomBar: true },
  { name: 'Meu Perfil', shortName: 'Perfil', href: '/patient/profile', icon: User },
];

const CHANGE_PASSWORD = '/patient/change-password';
const SYNC_FLAG = 'nutri_profile_sync';

export default function PatientLayout({ children }: { children: React.ReactNode }) {
  const { role, user, logout, ready, mustChangePassword } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  // Com senha temporária, nenhuma tela do paciente abre antes da troca.
  const mustChange = mustChangePassword && pathname !== CHANGE_PASSWORD;

  useEffect(() => {
    // Só decide depois que o Firebase confirmar a sessão; antes disso o papel ainda está carregando.
    if (ready && role !== 'patient') {
      router.replace('/login');
    } else if (ready && mustChange) {
      router.replace(CHANGE_PASSWORD);
    }
  }, [ready, role, mustChange, router]);

  useEffect(() => {
    // Conserto único das contas antigas: leva para o prontuário a triagem que ficava guardada à parte.
    // Roda uma vez por sessão do navegador; o servidor marca a conta para não repetir.
    if (!ready || role !== 'patient' || !user) return;
    try {
      if (sessionStorage.getItem(SYNC_FLAG) === user.uid) return;
      sessionStorage.setItem(SYNC_FLAG, user.uid);
    } catch {
      return;
    }
    postJson('/api/patient/profile', { sync: true })
      .then((result) => { if (result?.changed) window.location.reload(); })
      .catch(() => {});
  }, [ready, role, user]);

  if (!ready) return <AppLoading />;
  if (role !== 'patient' || mustChange) return null;

  // A troca de senha aparece sozinha, sem o menu do painel.
  if (pathname === CHANGE_PASSWORD) return <>{children}</>;

  return (
    <AppShell
      navigation={navigation}
      isActive={(href) => pathname === href}
      user={user}
      fallbackName="Paciente"
      onLogout={logout}
    >
      {children}
      {user && <ConsentGate uid={user.uid} role="patient" onLogout={logout} />}
    </AppShell>
  );
}
