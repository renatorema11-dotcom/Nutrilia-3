'use client';

import { useAuth } from '@/components/auth-provider';
import { useRouter, usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { LayoutDashboard, Users, MessageSquareText, LogOut, Apple } from 'lucide-react';
import Link from 'next/link';
import Script from 'next/script';

export default function NutritionistLayout({ children }: { children: React.ReactNode }) {
  const { role, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (role !== 'nutritionist') {
      router.push('/login');
    }
  }, [role, router]);

  if (role !== 'nutritionist') return null;

  const navigation = [
    { name: 'Dashboard', href: '/nutritionist', icon: LayoutDashboard },
    { name: 'Pacientes', href: '/nutritionist/patients', icon: Users },
    { name: 'Assistente IA', href: '/nutritionist/assistant', icon: MessageSquareText },
  ];

  return (
    <div className="flex h-screen w-full p-4 gap-4 bg-transparent">
      {/* Sidebar */}
      <aside className="w-64 glass flex flex-col p-6">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-[#4c8466] rounded-xl flex items-center justify-center text-white shadow-lg">
            <Apple className="h-6 w-6" />
          </div>
          <h1 className="font-bold text-[#276e58] text-xl tracking-tight">NutriAli</h1>
        </div>
        
        <nav className="flex-1 space-y-2">
          {navigation.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/nutritionist' && pathname.startsWith(`${item.href}/`));
            const Icon = item.icon;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-3 p-3 rounded-lg font-semibold transition-colors ${
                  isActive 
                    ? 'bg-white/40 text-teal-700 shadow-sm border border-white/50' 
                    : 'text-slate-600 hover:bg-white/40'
                }`}
              >
                <Icon className={`w-5 h-5 ${isActive ? 'text-teal-700' : 'text-slate-500'}`} />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto p-4 bg-teal-900/10 rounded-xl border border-teal-500/20">
          <button
            onClick={logout}
            className="flex items-center justify-between w-full text-sm font-medium text-slate-700 hover:text-teal-700 transition-colors"
          >
            <span>Sair</span>
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col gap-4 overflow-y-auto">
        <div className="w-full h-full max-w-5xl mx-auto py-2 pr-4">
          {children}
        </div>
      </main>

      {/* ElevenLabs Conversational Widget */}
      <Script src="https://unpkg.com/@elevenlabs/convai-widget-embed" strategy="lazyOnload" />
      {/* @ts-ignore - Custom Web Component from ElevenLabs */}
      <elevenlabs-convai agent-id="agent_8001kyyz220hfbwvv1esrt3ayryc"></elevenlabs-convai>
    </div>
  );
}
