'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BadgeCheck, Loader2, RefreshCw, ShieldCheck, Trash2, UserCheck } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { authFetch } from '@/lib/api-client';
import { Card, CardContent, Button, Badge } from '@/components/ui';

interface DeletionItem {
  uid: string;
  role: 'patient' | 'nutritionist';
  name: string;
  email: string;
  nutritionistName: string;
  reason: string;
  status: 'pending' | 'deleted' | 'kept';
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
}

const when = (iso: string | null) => {
  const date = new Date(iso || '');
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** Tela do responsável pelo NutriAli: pedidos de exclusão de conta (LGPD). O servidor confere quem pode. */
export default function DeletionsPage() {
  const { user, role, ready } = useAuth();
  const [items, setItems] = useState<DeletionItem[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  // Apagar pede um segundo toque no mesmo pedido: não tem volta.
  const [confirmDelete, setConfirmDelete] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await authFetch('/api/admin/deletions', { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setItems([]);
        setError(typeof data?.error === 'string' ? data.error : 'Não foi possível carregar os pedidos agora.');
        return;
      }
      setItems(Array.isArray(data?.deletions) ? data.deletions : []);
    } catch {
      setItems([]);
      setError('Não foi possível carregar os pedidos agora.');
    }
  }, []);

  useEffect(() => {
    if (ready && user) load();
  }, [ready, user, load]);

  const decide = async (item: DeletionItem, decision: 'delete' | 'keep') => {
    if (busy) return;
    setBusy(item.uid);
    setNotice('');
    setError('');
    setConfirmDelete('');
    try {
      const res = await authFetch('/api/admin/deletions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: item.uid, decision }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'Não foi possível registrar a decisão agora.');
        return;
      }
      setNotice(decision === 'delete'
        ? `Os dados de ${item.name || item.email} foram apagados. Avise a pessoa pelo e-mail ${item.email || 'cadastrado'} que o pedido foi atendido.`
        : `A conta de ${item.name || item.email} foi mantida. Explique o motivo à pessoa pelo e-mail ${item.email || 'cadastrado'}.`);
      await load();
    } catch {
      setError('Não foi possível registrar a decisão agora.');
    } finally {
      setBusy('');
    }
  };

  if (!ready) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-teal-600" /></div>;
  }

  const pending = (items || []).filter((item) => item.status === 'pending');
  const decided = (items || []).filter((item) => item.status !== 'pending');

  const card = (item: DeletionItem) => (
    <Card key={item.uid} className="bg-white">
      <CardContent className="p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-bold text-slate-800 break-words">{item.name || (item.status === 'deleted' ? 'Dados apagados' : 'Sem nome')}</h3>
            {item.email && <p className="text-sm text-slate-600 break-all">{item.email}</p>}
          </div>
          <Badge variant={item.status === 'pending' ? 'warning' : item.status === 'deleted' ? 'default' : 'success'}>
            {item.status === 'pending' ? 'Aguardando' : item.status === 'deleted' ? 'Apagado' : 'Mantido'}
          </Badge>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-700">
          <div><dt className="inline font-semibold">Tipo: </dt><dd className="inline">{item.role === 'patient' ? 'Paciente' : 'Nutricionista'}</dd></div>
          {item.nutritionistName && <div><dt className="inline font-semibold">Nutricionista: </dt><dd className="inline">{item.nutritionistName}</dd></div>}
          <div><dt className="inline font-semibold">Pedido em: </dt><dd className="inline">{when(item.requestedAt) || 'sem data'}</dd></div>
          {item.decidedAt && <div><dt className="inline font-semibold">Decidido em: </dt><dd className="inline">{when(item.decidedAt)}</dd></div>}
        </dl>
        {item.reason && <p className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm text-slate-700"><strong>Motivo:</strong> {item.reason}</p>}
        {item.status === 'pending' && (
          <>
            <p className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
              {item.role === 'patient'
                ? 'Antes de apagar, confirme com a nutricionista se o prontuário precisa ser guardado por algum prazo profissional. Apagar remove a conta, o prontuário, as refeições, as conversas, os pedidos, as consultas e as anotações da nutricionista sobre esta pessoa. Não tem volta.'
                : 'Conta de nutricionista: combine com ela o que fazer com os pacientes. A exclusão automática ainda não está disponível para nutricionistas; depois de resolver, marque como mantida.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {item.role === 'patient' && (confirmDelete === item.uid ? (
                <Button variant="danger" onClick={() => decide(item, 'delete')} disabled={!!busy} className="text-xs py-2 gap-1.5">
                  {busy === item.uid ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Confirmar: apagar de vez
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setConfirmDelete(item.uid)} disabled={!!busy} className="text-xs py-2 gap-1.5 border-red-200 text-red-700">
                  <Trash2 className="w-3.5 h-3.5" />
                  Apagar os dados
                </Button>
              ))}
              <Button variant="outline" onClick={() => decide(item, 'keep')} disabled={!!busy} className="text-xs py-2 gap-1.5 border-slate-300">
                <UserCheck className="w-3.5 h-3.5" />
                Manter a conta
              </Button>
            </div>
          </>
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
            <h1 className="text-2xl font-bold text-slate-800">Pedidos de exclusão de conta</h1>
            <p className="text-sm text-slate-600">Pela LGPD, cada pedido precisa de resposta em até 15 dias.</p>
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
            <p>Para ver os pedidos de exclusão, entre no aplicativo pelo botão &quot;Entrar com o Google&quot;, usando o mesmo e-mail que recebe os avisos de cadastro.</p>
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
                <section className="space-y-3">
                  <h2 className="text-sm font-bold uppercase tracking-wider text-slate-600">Aguardando decisão ({pending.length})</h2>
                  {pending.length === 0 ? (
                    <Card><CardContent className="p-6 text-center text-sm text-slate-600 space-y-2">
                      <BadgeCheck className="w-8 h-8 text-teal-600 mx-auto" />
                      <p>Nenhum pedido esperando.</p>
                    </CardContent></Card>
                  ) : pending.map(card)}
                </section>
                {decided.length > 0 && (
                  <section className="space-y-3">
                    <h2 className="text-sm font-bold uppercase tracking-wider text-slate-600">Já decididos</h2>
                    {decided.map(card)}
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
