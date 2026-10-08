'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { Apple, LogOut, Menu, X, Loader2, type LucideIcon } from 'lucide-react';
import type { User } from '@/lib/firebase';
import { LanguageSelector } from '@/components/language-selector';

export interface NavItem {
  name: string;
  /** Rótulo curto da barra inferior do celular. */
  shortName: string;
  href: string;
  icon: LucideIcon;
  /** Aparece na barra inferior do celular (no máximo 5 itens). */
  inBottomBar?: boolean;
}

interface AppShellProps {
  navigation: NavItem[];
  isActive: (href: string) => boolean;
  user: User | null;
  fallbackName: string;
  onLogout: () => void;
  children: React.ReactNode;
}

/**
 * Estrutura do painel logado. No computador mantém o menu lateral; no celular e no
 * tablet usa barra superior, barra de navegação inferior e menu deslizante.
 */
export function AppShell({ navigation, isActive, user, fallbackName, onLogout, children }: AppShellProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const homeHref = navigation[0]?.href || '/';
  const bottomItems = navigation.filter((item) => item.inBottomBar).slice(0, 5);

  // Fecha o menu ao trocar de página.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Com o menu aberto: fecha no Esc e trava a rolagem da página de fundo.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const navLinks = (
    <nav className="flex-1 space-y-2">
      {navigation.map((item) => {
        const active = isActive(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-3 p-3 rounded-lg font-semibold transition-colors ${
              active
                ? 'bg-white/40 text-teal-700 shadow-sm border border-white/50'
                : 'text-slate-600 hover:bg-white/40'
            }`}
          >
            <Icon className={`w-5 h-5 ${active ? 'text-teal-700' : 'text-slate-500'}`} />
            {item.name}
          </Link>
        );
      })}
    </nav>
  );

  const accountBlock = (
    <div className="mt-auto flex flex-col gap-3">
      {user && (
        <div className="flex items-center gap-3 p-3 bg-white/50 rounded-xl border border-white/60 shadow-sm">
          <div className="w-10 h-10 rounded-full overflow-hidden bg-slate-200 shrink-0">
            {user.photoURL && user.photoURL.trim() ? (
              <Image src={user.photoURL} alt={user.displayName || 'Usuário'} width={40} height={40} className="w-full h-full object-cover" referrerPolicy="no-referrer" unoptimized />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-teal-100 text-teal-700 font-bold">
                {user.displayName?.charAt(0).toUpperCase() || 'U'}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-800 truncate">{user.displayName || fallbackName}</p>
            <p className="text-xs text-slate-500 truncate">{user.email}</p>
          </div>
        </div>
      )}
      <div className="p-4 bg-teal-900/10 rounded-xl border border-teal-500/20">
        <button
          onClick={onLogout}
          className="flex items-center justify-between w-full text-sm font-medium text-slate-700 hover:text-teal-700 transition-colors"
        >
          <span>Sair</span>
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  const logo = (size: 'md' | 'sm') => (
    <>
      <div className={`${size === 'md' ? 'w-10 h-10' : 'w-9 h-9'} bg-[#4c8466] rounded-xl flex items-center justify-center text-white shadow-lg shrink-0`}>
        <Apple className={size === 'md' ? 'h-6 w-6' : 'h-5 w-5'} />
      </div>
      <span className={`font-bold text-[#276e58] tracking-tight ${size === 'md' ? 'text-xl' : 'text-lg'}`}>NutriAli</span>
    </>
  );

  return (
    <div className="min-h-dvh w-full bg-transparent lg:flex lg:h-screen lg:p-4 lg:gap-4">
      {/* Menu lateral (computador) */}
      <aside className="hidden lg:flex w-64 shrink-0 glass flex-col p-6">
        <div className="flex items-center gap-3 mb-8">{logo('md')}</div>
        {navLinks}
        {accountBlock}
      </aside>

      {/* Barra superior (celular e tablet) */}
      <header className="lg:hidden sticky top-0 z-30 px-3 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-2">
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-white/60 bg-white/80 backdrop-blur-xl px-3 py-2 shadow-sm">
          <Link href={homeHref} className="flex items-center gap-2 min-w-0">
            {logo('sm')}
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSelector compact />
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Abrir menu"
              aria-expanded={menuOpen}
              className="w-10 h-10 rounded-xl border border-slate-200/80 bg-white text-slate-700 flex items-center justify-center shadow-sm active:scale-95 transition-transform"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Conteúdo */}
      <main className="lg:flex-1 lg:flex lg:flex-col lg:gap-4 lg:overflow-y-auto">
        <div className="w-full max-w-5xl mx-auto px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+6rem)] lg:h-full lg:px-0 lg:py-2 lg:pr-4">
          <div className="hidden lg:flex justify-end mb-3">
            <LanguageSelector />
          </div>
          {children}
        </div>
      </main>

      {/* Navegação inferior (celular e tablet) */}
      {bottomItems.length > 0 && (
        <nav
          aria-label="Navegação principal"
          className="lg:hidden fixed inset-x-0 bottom-0 z-30 px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pointer-events-none"
        >
          <div className="pointer-events-auto mx-auto max-w-lg flex items-stretch gap-1 rounded-2xl border border-white/60 bg-white/85 backdrop-blur-xl p-1 shadow-lg shadow-slate-900/10">
            {bottomItems.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-1 rounded-xl py-2 text-[11px] font-semibold transition-colors ${
                    active ? 'bg-teal-50 text-teal-700' : 'text-slate-500 active:bg-slate-100'
                  }`}
                >
                  <Icon className="w-5 h-5 shrink-0" />
                  <span className="truncate max-w-full leading-none">{item.shortName}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      {/* Menu deslizante (celular e tablet) */}
      {menuOpen && (
        <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-fade-in" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-[min(20rem,86vw)] bg-white/95 backdrop-blur-xl shadow-2xl flex flex-col gap-6 px-5 pt-[calc(env(safe-area-inset-top)+1.25rem)] pb-[calc(env(safe-area-inset-bottom)+1.25rem)] overflow-y-auto animate-drawer-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">{logo('sm')}</div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Fechar menu"
                className="w-10 h-10 rounded-xl text-slate-500 hover:bg-slate-100 flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {navLinks}
            {accountBlock}
          </div>
        </div>
      )}
    </div>
  );
}

/** Tela de espera enquanto o login é confirmado (evita mandar quem já entrou de volta ao login). */
export function AppLoading() {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center gap-3 text-slate-600">
      <div className="w-12 h-12 bg-[#4c8466] rounded-2xl flex items-center justify-center text-white shadow-lg">
        <Apple className="h-6 w-6" />
      </div>
      <Loader2 className="w-5 h-5 animate-spin text-teal-600" aria-label="Carregando" />
    </div>
  );
}
