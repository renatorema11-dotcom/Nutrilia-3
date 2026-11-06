'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BadgeCheck, CheckCircle2, ExternalLink, Loader2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { authFetch } from '@/lib/api-client';
import { Card, CardContent, Button, Badge } from '@/components/ui';
import { CFN_LOOKUP_URL, parseCrn } from '@/lib/crn';

interface ApprovalItem {
  uid: string;
  name: string;
  email: string;
  crn: string;
  specialty: string;
  phone: string;
  approval: 'approved' | 'pending' | 'rejected';
  requestedAt: string;
  decidedAt: string;
}

const when = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

/** Tela do responsável pelo NutriAli: aprova ou recusa os cadastros de nutricionista. O servidor confere quem pode. */
export default function ApprovalsPage() {
  const { user, role, ready } = useAuth();
  const [items, setItems] = useState<ApprovalItem[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  // Recusar pede um segundo toque no mesmo cadastro, para não acontecer por engano.
  const [confirmReject, setConfirmReject] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await authFetch('/api/admin/approvals', { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setItems([]);
        setError(typeof data?.error === 'string' ? data.error : 'Não foi possível carregar os cadastros agora.');
        return;
      }
      setItems(Array.isArray(data?.approvals) ? data.approvals : []);
    } catch {
      setItems([]);
      setError('Não foi possível carregar os cadastros agora.');
    }
  }, []);

  useEffect(() => {
    if (ready && user) load();
  }, [ready, user, load]);

  const decide = async (item: ApprovalItem, decision: 'approve' | 'reject') => {
    if (busy) return;
    setBusy(item.uid);
    setNotice('');
    setError('');
    setConfirmReject('');
    try {
      const res = await authFetch('/api/admin/approvals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: item.uid, decision }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(typeof data?.error === 'string' ? data.error : 'Não foi possível registrar a decisão agora.');
        return;
      }
      const done = decision === 'approve' ? `${item.name} foi aprovado(a) e já pode usar a área de nutricionista.` : `O cadastro de ${item.name} foi recusado.`;
      setNotice(data?.emailed ? `${done} O aviso seguiu por e-mail.` : `${done} O e-mail de aviso não saiu (conecte o Google em "Minha Ali"); avise a pessoa por fora.`);
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

  const pending = (items || []).filter((item) => item.approval === 'pending');
  const decided = (items || []).filter((item) => item.approval !== 'pending');

  const card = (item: ApprovalItem) => {
    const crn = parseCrn(item.crn);
    return (
      <Card key={item.uid} className="bg-white">
        <CardContent className="p-5 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-bold text-slate-800 break-words">{item.name}</h3>
              <p className="text-sm text-slate-600 break-all">{item.email}</p>
            </div>
            <Badge variant={item.approval === 'approved' ? 'success' : item.approval === 'pending' ? 'warning' : 'default'}>
              {item.approval === 'approved' ? 'Aprovado' : item.approval === 'pending' ? 'Aguardando' : 'Recusado'}
            </Badge>
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-700">
            <div><dt className="inline font-semibold">CRN: </dt><dd className="inline">{item.crn || 'não informado'}</dd></div>
            <div><dt className="inline font-semibold">Especialidade: </dt><dd className="inline">{item.specialty || 'não informada'}</dd></div>
            <div><dt className="inline font-semibold">Telefone: </dt><dd className="inline">{item.phone || 'não informado'}</dd></div>
            <div><dt className="inline font-semibold">Pedido em: </dt><dd className="inline">{when(item.requestedAt) || 'sem data'}</dd></div>
            {item.decidedAt && <div><dt className="inline font-semibold">Decidido em: </dt><dd className="inline">{when(item.decidedAt)}</dd></div>}
          </dl>
          {item.approval === 'pending' && (
            <p className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600">
              Antes de aprovar, abra a consulta do Conselho Federal de Nutrição
              {crn.ok ? <>, escolha <strong>CRN{crn.region}</strong>, digite a inscrição <strong>{crn.number.split('/')[0]}</strong></> : null} e
              confira se o nome bate e se o registro está ativo.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <a href={CFN_LOOKUP_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              Conferir no CFN <ExternalLink className="w-3.5 h-3.5" />
            </a>
            {item.approval !== 'approved' && (
              <Button onClick={() => decide(item, 'approve')} disabled={!!busy} className="text-xs py-2 gap-1.5">
                {busy === item.uid ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Aprovar
              </Button>
            )}
            {item.approval !== 'rejected' && (confirmReject === item.uid ? (
              <Button variant="danger" onClick={() => decide(item, 'reject')} disabled={!!busy} className="text-xs py-2 gap-1.5">
                <XCircle className="w-3.5 h-3.5" />
                Confirmar recusa
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setConfirmReject(item.uid)} disabled={!!busy} className="text-xs py-2 gap-1.5 border-slate-300">
                <XCircle className="w-3.5 h-3.5" />
                {item.approval === 'approved' ? 'Suspender acesso' : 'Recusar'}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-teal-700 font-semibold text-xs uppercase tracking-wider mb-1">
              <ShieldCheck className="w-4 h-4" /> Responsável pelo NutriAli
            </div>
            <h1 className="text-2xl font-bold text-slate-800">Aprovação de nutricionistas</h1>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Link href="/admin/exclusoes" className="text-xs font-semibold text-teal-700 hover:text-teal-800">Ver pedidos de exclusão de conta</Link>
              <Link href="/admin/erros" className="text-xs font-semibold text-teal-700 hover:text-teal-800">Ver erros do servidor</Link>
              <Link href="/admin/premium" className="text-xs font-semibold text-teal-700 hover:text-teal-800">Dar Premium de cortesia</Link>
            </div>
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
            <p><strong>Para aprovar um cadastro, não precisa entrar aqui:</strong> use o botão &quot;Ver cadastro e aprovar&quot; do e-mail de aviso. Ele abre o cadastro já com as opções de aprovar e recusar.</p>
            <p>Esta página mostra a lista completa. Para vê-la, entre no aplicativo pelo botão &quot;Entrar com o Google&quot;, usando o mesmo e-mail que recebe os avisos de cadastro, e abra &quot;Aprovações&quot; no menu.</p>
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
                  <h2 className="text-sm font-bold uppercase tracking-wider text-slate-600">Aguardando aprovação ({pending.length})</h2>
                  {pending.length === 0 ? (
                    <Card><CardContent className="p-6 text-center text-sm text-slate-600 space-y-2">
                      <BadgeCheck className="w-8 h-8 text-teal-600 mx-auto" />
                      <p>Nenhum cadastro esperando.</p>
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
