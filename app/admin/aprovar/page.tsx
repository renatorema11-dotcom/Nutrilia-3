'use client';

import { useEffect, useState } from 'react';
import { Apple, CheckCircle2, ExternalLink, Hourglass, Loader2, XCircle } from 'lucide-react';
import { Card, CardContent, Button } from '@/components/ui';
import { CFN_LOOKUP_URL, parseCrn } from '@/lib/crn';

interface ApprovalItem {
  name: string;
  email: string;
  crn: string;
  specialty: string;
  phone: string;
  approval: 'approved' | 'pending' | 'rejected';
  requestedAt: string;
}

const when = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

async function callLink(body: Record<string, unknown>): Promise<{ ok: boolean; data: any }> {
  const res = await fetch('/api/admin/approval-link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
  return { ok: res.ok, data: await res.json().catch(() => null) };
}

/**
 * Tela aberta pelo botão do e-mail de aviso: mostra UM cadastro de nutricionista e os botões de aprovar e recusar.
 * Não pede login: quem autoriza é o código assinado que vem no link (depois do "#", para não ficar em registros).
 */
export default function ApproveByLinkPage() {
  const [token, setToken] = useState('');
  const [item, setItem] = useState<ApprovalItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [done, setDone] = useState('');

  useEffect(() => {
    const fromLink = window.location.hash.replace(/^#/, '') || new URLSearchParams(window.location.search).get('t') || '';
    setToken(fromLink);
    if (!fromLink) {
      setError('Este endereço precisa ser aberto pelo botão do e-mail de aviso.');
      setLoading(false);
      return;
    }
    callLink({ token: fromLink })
      .then(({ ok, data }) => {
        if (ok && data?.record) setItem(data.record);
        else setError(typeof data?.error === 'string' ? data.error : 'Não foi possível abrir este cadastro agora.');
      })
      .catch(() => setError('Não foi possível abrir este cadastro agora. Confira a conexão e tente de novo.'))
      .finally(() => setLoading(false));
  }, []);

  const decide = async (decision: 'approve' | 'reject') => {
    if (busy || !item) return;
    setBusy(true);
    setError('');
    setConfirmReject(false);
    try {
      const { ok, data } = await callLink({ token, decision });
      if (!ok) {
        setError(typeof data?.error === 'string' ? data.error : 'Não foi possível registrar a decisão agora.');
        return;
      }
      setItem({ ...item, approval: data.approval });
      const mail = data.emailed ? ' A pessoa foi avisada por e-mail.' : ' O e-mail de aviso não saiu; avise a pessoa por fora.';
      setDone(data.approval === 'approved'
        ? `Pronto: ${item.name} está aprovado(a) e já pode usar a área de nutricionista.${mail}`
        : `O cadastro de ${item.name} foi recusado.${mail}`);
    } catch {
      setError('Não foi possível registrar a decisão agora. Confira a conexão e tente de novo.');
    } finally {
      setBusy(false);
    }
  };

  const crn = parseCrn(item?.crn);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 bg-[#4c8466] rounded-xl flex items-center justify-center shadow-lg">
            <Apple className="h-6 w-6 text-white" />
          </div>
          <h1 className="mt-4 text-2xl font-bold text-slate-800">Aprovar nutricionista</h1>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-5">
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-teal-600" /></div>
            ) : !item ? (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-bold text-slate-800 break-words">{item.name}</h2>
                    <p className="text-sm text-slate-600 break-all">{item.email}</p>
                  </div>
                  <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    item.approval === 'approved' ? 'bg-teal-100 text-teal-800' : item.approval === 'pending' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {item.approval === 'approved' ? <CheckCircle2 className="w-3.5 h-3.5" /> : item.approval === 'pending' ? <Hourglass className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                    {item.approval === 'approved' ? 'Aprovado' : item.approval === 'pending' ? 'Em análise' : 'Recusado'}
                  </span>
                </div>

                <dl className="space-y-1 text-sm text-slate-700">
                  <div><dt className="inline font-semibold">CRN: </dt><dd className="inline">{item.crn || 'não informado'}</dd></div>
                  <div><dt className="inline font-semibold">Especialidade: </dt><dd className="inline">{item.specialty || 'não informada'}</dd></div>
                  <div><dt className="inline font-semibold">Telefone: </dt><dd className="inline">{item.phone || 'não informado'}</dd></div>
                  {when(item.requestedAt) && <div><dt className="inline font-semibold">Pedido em: </dt><dd className="inline">{when(item.requestedAt)}</dd></div>}
                </dl>

                <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-2">
                  <p className="text-xs text-slate-600">
                    <strong>1. Confira o registro.</strong> Abra a consulta do Conselho Federal de Nutrição
                    {crn.ok ? <>, escolha <strong>CRN{crn.region}</strong>, digite a inscrição <strong>{crn.number.split('/')[0]}</strong></> : null} e
                    veja se o nome bate e se o registro está ativo.
                  </p>
                  <a href={CFN_LOOKUP_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                    Conferir no CFN <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>

                {done && <p role="status" className="rounded-lg border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">{done}</p>}
                {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

                <div className="space-y-2">
                  <p className="text-xs text-slate-600"><strong>2. Decida.</strong> Enquanto você não decidir, a pessoa continua em análise e não acessa o aplicativo.</p>
                  {item.approval !== 'approved' && (
                    <Button onClick={() => decide('approve')} disabled={busy} className="w-full h-12 text-base gap-2">
                      {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                      Aprovar cadastro
                    </Button>
                  )}
                  {item.approval !== 'rejected' && (confirmReject ? (
                    <Button variant="danger" onClick={() => decide('reject')} disabled={busy} className="w-full gap-2">
                      <XCircle className="w-4 h-4" />
                      Confirmar: {item.approval === 'approved' ? 'suspender o acesso' : 'recusar o cadastro'}
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={() => setConfirmReject(true)} disabled={busy} className="w-full gap-2 border-slate-300">
                      <XCircle className="w-4 h-4" />
                      {item.approval === 'approved' ? 'Suspender acesso' : 'Recusar'}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
