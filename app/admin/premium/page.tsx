'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Crown, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { ApiError, postJson } from '@/lib/api-client';
import { Card, CardContent, Button, Input } from '@/components/ui';

/** Tela do responsável pelo NutriAli: Premium de cortesia para um paciente (demonstração, testes, parcerias). */
export default function PremiumCourtesyPage() {
  const { user, role, ready } = useAuth();
  const [email, setEmail] = useState('');
  const [days, setDays] = useState('30');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const save = async (value: number) => {
    if (busy) return;
    setBusy(true);
    setNotice('');
    setError('');
    try {
      const data = await postJson('/api/admin/premium', { email, days: value });
      setNotice(data.until
        ? `${data.name} tem Premium de cortesia até ${new Date(data.until).toLocaleDateString('pt-BR')}.`
        : `A cortesia de ${data.name} foi retirada.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar agora.');
    } finally {
      setBusy(false);
    }
  };

  if (!ready) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-teal-600" /></div>;
  }

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="mx-auto w-full max-w-xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-teal-700 font-semibold text-xs uppercase tracking-wider mb-1">
              <ShieldCheck className="w-4 h-4" /> Responsável pelo NutriAli
            </div>
            <h1 className="text-2xl font-bold text-slate-800">Premium de cortesia</h1>
            <p className="text-sm text-slate-600">Libera o Premium para um paciente sem cobrança, por alguns dias.</p>
          </div>
          <Link href={role ? `/${role}` : '/login'} className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 hover:text-teal-800">
            <ArrowLeft className="w-4 h-4" />
            {role ? 'Voltar ao painel' : 'Entrar'}
          </Link>
        </div>

        {!user ? (
          <p className="text-sm text-slate-600">Entre com a sua conta para continuar.</p>
        ) : (
          <Card className="bg-white">
            <CardContent className="p-5 space-y-4">
              <Input id="premium-email" label="E-mail do paciente" type="email" placeholder="paciente@exemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <Input id="premium-days" label="Por quantos dias" type="number" min={1} max={366} value={days} onChange={(e) => setDays(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => save(Number(days))} disabled={busy || !email} className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crown className="w-4 h-4" />}
                  Dar cortesia
                </Button>
                <Button variant="outline" onClick={() => save(0)} disabled={busy || !email} className="border-slate-300">
                  Retirar cortesia
                </Button>
              </div>
              {notice && <p role="status" className="text-sm font-medium text-emerald-700">{notice}</p>}
              {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
              <p className="text-xs text-slate-500">A cortesia não mexe na assinatura paga: se o paciente também pagar, vale o prazo mais longo.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
