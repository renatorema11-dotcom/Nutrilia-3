'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BadgeCheck, CheckCheck, Loader2, MailCheck, RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { authFetch } from '@/lib/api-client';
import { Card, CardContent, Button, Badge } from '@/components/ui';

interface AlertItem {
  id: string;
  label: string;
  code: string;
  count: number;
  firstAt: string;
  lastAt: string;
  notifiedAt: string | null;
  resolvedAt: string | null;
  open: boolean;
}

const when = (iso: string | null) => {
  const date = new Date(iso || '');
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** Tela do responsável pelo NutriAli: erros do servidor registrados e o teste do aviso por e-mail. */
export default function ServerErrorsPage() {
  const { user, role, ready } = useAuth();
  const [items, setItems] = useState<AlertItem[] | null>(null);
  const [email, setEmail] = useState<{ ready: boolean; recipients: number } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await authFetch('/api/admin/server-alerts', { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setItems([]);
        setError(typeof data?.error === 'string' ? data.error : 'Não foi possível carregar a lista agora.');
        return;
      }
      setItems(Array.isArray(data?.alerts) ? data.alerts : []);
      setEmail(data?.email && typeof data.email.ready === 'boolean' ? data.email : null);
    } catch {
      setItems([]);
      setError('Não foi possível carregar a lista agora.');
    }
  }, []);

  useEffect(() => {
    if (ready && user) load();
  }, [ready, user, load]);

  const act = async (key: string, body: Record<string, unknown>, done: string) => {
    if (busy) return;
    setBusy(key);
    setNotice('');
    setError('');
    try {
      const res = await authFetch('/api/admin/server-alerts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'Não foi possível concluir agora.');
        return;
      }
      setNotice(done);
      await load();
    } catch {
      setError('Não foi possível concluir agora.');
    } finally {
      setBusy('');
    }
  };

  if (!ready) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-teal-600" /></div>;
  }

  const open = (items || []).filter((item) => item.open);
  const resolved = (items || []).filter((item) => !item.open);

  const card = (item: AlertItem) => (
    <Card key={item.id} className="bg-white">
      <CardContent className="p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="min-w-0 font-bold text-slate-800 break-words">{item.label}</h3>
          <Badge variant={item.open ? 'warning' : 'success'}>{item.open ? 'Em aberto' : 'Resolvido'}</Badge>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-700">
          <div><dt className="inline font-semibold">Vezes: </dt><dd className="inline">{item.count}</dd></div>
          <div><dt className="inline font-semibold">Última vez: </dt><dd className="inline">{when(item.lastAt) || 'sem data'}</dd></div>
          <div><dt className="inline font-semibold">Primeira vez: </dt><dd className="inline">{when(item.firstAt) || 'sem data'}</dd></div>
          <div><dt className="inline font-semibold">Último aviso por e-mail: </dt><dd className="inline">{when(item.notifiedAt) || 'nenhum'}</dd></div>
          {item.code && <div><dt className="inline font-semibold">Código técnico: </dt><dd className="inline break-all">{item.code}</dd></div>}
          {item.resolvedAt && <div><dt className="inline font-semibold">Marcado como resolvido: </dt><dd className="inline">{when(item.resolvedAt)}</dd></div>}
        </dl>
        {item.open && (
          <Button variant="outline" onClick={() => act(item.id, { action: 'resolve', id: item.id }, 'Erro marcado como resolvido. Se acontecer de novo, ele volta para a lista e você recebe um aviso.')}
            disabled={!!busy} className="text-xs py-2 gap-1.5 border-slate-300">
            {busy === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
            Marcar como resolvido
          </Button>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-teal-700 font-semibold text-xs uppercase tracking-wider mb-1">
              <ShieldCheck className="w-4 h-4" /> Responsável pelo NutriAli
            </div>
            <h1 className="text-2xl font-bold text-slate-800">Erros do servidor</h1>
            <p className="text-sm text-slate-600">Falhas registradas pelo aplicativo. Nenhum dado de paciente aparece aqui.</p>
          </div>
          <div className="flex items-center gap-2">
            {user && (
              <Button variant="outline" onClick={load} className="text-xs gap-1.5 border-slate-300">
                <RefreshCw className="w-3.5 h-3.5" />
                Atualizar
              </Button>
            )}
            <Link href={role ? `/${role}` : '/login'} className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 hover:text-teal-800">
              <ArrowLeft className="w-4 h-4" />
              {role ? 'Voltar ao painel' : 'Entrar'}
            </Link>
          </div>
        </div>

        {!user ? (
          <Card><CardContent className="p-6 text-sm text-slate-700 space-y-3">
            <p>Para ver os erros do servidor, entre no aplicativo pelo botão &quot;Entrar com o Google&quot;, usando o mesmo e-mail que recebe os avisos de cadastro.</p>
            <Link href="/login" className="inline-flex items-center rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700">Ir para o login</Link>
          </CardContent></Card>
        ) : (
          <>
            {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
            {notice && <p role="status" className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">{notice}</p>}
            {items === null ? (
              <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-teal-600" /></div>
            ) : !error && (
              <>
                <Card className="bg-white">
                  <CardContent className="p-5 space-y-3 text-sm text-slate-700">
                    {email?.ready ? (
                      <p className="flex items-start gap-2"><MailCheck className="w-4 h-4 mt-0.5 text-teal-600 shrink-0" />Os avisos saem por e-mail para {email.recipients === 1 ? 'o responsável' : `os ${email.recipients} responsáveis`}: no máximo um de cada erro a cada 6 horas.</p>
                    ) : (
                      <p className="flex items-start gap-2 text-amber-900"><TriangleAlert className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />Os avisos por e-mail estão parados: nenhum responsável está com o Google conectado no app. Conecte o Google na sua conta de nutricionista (Configurações da Ali). Os erros continuam sendo registrados aqui.</p>
                    )}
                    <Button variant="outline" onClick={() => act('test', { action: 'test' }, 'E-mail de teste enviado. Confira a sua caixa de entrada (e o spam).')}
                      disabled={!!busy} className="text-xs py-2 gap-1.5 border-slate-300">
                      {busy === 'test' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MailCheck className="w-3.5 h-3.5" />}
                      Enviar e-mail de teste
                    </Button>
                  </CardContent>
                </Card>
                <section className="space-y-3">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-slate-600">Em aberto ({open.length})</h2>
                  {open.length === 0 ? (
                    <Card><CardContent className="p-6 text-center text-sm text-slate-600 space-y-2">
                      <BadgeCheck className="w-8 h-8 text-teal-600 mx-auto" />
                      <p>Nenhum erro em aberto.</p>
                    </CardContent></Card>
                  ) : open.map(card)}
                </section>
                {resolved.length > 0 && (
                  <section className="space-y-3">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-slate-600">Resolvidos</h2>
                    {resolved.map(card)}
                  </section>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
