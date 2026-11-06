'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { doc, onSnapshot } from 'firebase/firestore';
import { Crown, Lock } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui';
import { PREMIUM_FEATURES, isPremiumActive, type PremiumFeature } from '@/lib/premium';

export interface PremiumState {
  loading: boolean;
  active: boolean;
  /** O que o servidor guardou: paidUntil, courtesyUntil, subscriptionActive. */
  premium: Record<string, unknown> | null;
}

/** Premium do paciente logado, ao vivo: liga sozinho quando o servidor recebe a confirmação do pagamento. */
export function usePremium(): PremiumState {
  const { user } = useAuth();
  const [state, setState] = useState<PremiumState>({ loading: true, active: false, premium: null });
  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(db, 'patients', user.uid),
      (snap) => {
        const premium = (snap.data()?.premium as Record<string, unknown> | undefined) || null;
        setState({ loading: false, active: isPremiumActive(premium), premium });
      },
      () => setState({ loading: false, active: false, premium: null }),
    );
  }, [user]);
  return state;
}

/** Cartão no lugar de uma função do Premium, com o convite para conhecer o plano. */
export function PremiumLock({ feature }: { feature: PremiumFeature }) {
  const info = PREMIUM_FEATURES.find((item) => item.id === feature);
  if (!info) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-5 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="w-11 h-11 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
        <Lock className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-amber-900">{info.title}: só no Premium</p>
        <p className="text-sm text-amber-900/80 mt-0.5">{info.text}</p>
      </div>
      <Link href="/patient/premium" className="shrink-0">
        <Button className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5 w-full sm:w-auto">
          <Crown className="w-4 h-4" /> Conhecer o Premium
        </Button>
      </Link>
    </div>
  );
}

/** Botão travado no lugar de uma ação do Premium (ex.: "Exportar PDF"): leva à tela do plano. */
export function PremiumButton({ label, className = '' }: { label: string; className?: string }) {
  return (
    <Link href="/patient/premium" title="Disponível no Premium"
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 text-amber-800 font-semibold hover:bg-amber-100 ${className}`}>
      <Lock className="w-3.5 h-3.5" /> {label}
    </Link>
  );
}
