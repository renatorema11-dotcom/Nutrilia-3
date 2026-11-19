'use client';

import { useEffect, useState } from 'react';
import { Download, Loader2, ShieldCheck, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Button } from '@/components/ui';
import { ApiError, authFetch, postJson } from '@/lib/api-client';
import { PRIVACY_CONTACT } from '@/lib/privacy';

type Deletion = { status: 'pending' | 'deleted' | 'kept'; requestedAt: string; decidedAt: string | null } | null;

const day = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('pt-BR');
};

/** "Privacidade e dados" em Meu Perfil: política, baixar meus dados (paciente) e pedido de exclusão da conta. */
export function PrivacyCard({ role }: { role: 'patient' | 'nutritionist' }) {
  const [deletion, setDeletion] = useState<Deletion | undefined>(undefined);
  const [downloading, setDownloading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    authFetch('/api/account/privacy', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (active) setDeletion(data ? data.deletion ?? null : null); })
      .catch(() => { if (active) setDeletion(null); });
    return () => { active = false; };
  }, []);

  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    setError('');
    try {
      const res = await authFetch('/api/patient/export', { cache: 'no-store' });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new ApiError(typeof data?.error === 'string' ? data.error : 'Não foi possível baixar os seus dados agora.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `nutriali-meus-dados-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível baixar os seus dados agora.');
    } finally {
      setDownloading(false);
    }
  };

  const requestDeletion = async () => {
    if (sending) return;
    setSending(true);
    setError('');
    try {
      const data = await postJson('/api/account/privacy', { action: 'request_deletion', reason });
      setDeletion(data.deletion);
      setConfirming(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível registrar o pedido agora.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-teal-600" /> Privacidade e dados</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-slate-700">
        <p>
          Veja como o NutriAli cuida dos seus dados na{' '}
          <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="font-semibold text-teal-700 underline">Política de Privacidade</a>
          {' '}e as regras de uso nos{' '}
          <a href="/termos" target="_blank" rel="noopener noreferrer" className="font-semibold text-teal-700 underline">Termos de Uso</a>.
          Dúvidas e pedidos: {PRIVACY_CONTACT}.
        </p>

        {role === 'patient' && (
          <div className="space-y-2">
            <Button variant="outline" onClick={download} disabled={downloading} className="gap-2 border-slate-300 text-sm">
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Baixar meus dados
            </Button>
            <p className="text-xs text-slate-500">Um arquivo com o seu prontuário, plano aprovado, refeições, conversas com a nutricionista e consultas.</p>
          </div>
        )}

        <div className="space-y-2 border-t border-slate-200 pt-4">
          {deletion === undefined ? (
            <p className="text-xs text-slate-500">Carregando...</p>
          ) : deletion?.status === 'pending' ? (
            <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
              Pedido de exclusão enviado em {day(deletion.requestedAt)}. O responsável pelo NutriAli vai analisar e responder pelo seu e-mail em até 15 dias.
            </p>
          ) : confirming ? (
            <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-red-900">
                {role === 'patient'
                  ? 'A exclusão apaga a sua conta, o prontuário, as refeições e as conversas. Antes, o responsável confere se algum dado precisa ser guardado por obrigação legal, e a sua nutricionista é avisada.'
                  : 'A exclusão apaga a sua conta de nutricionista. Antes, o responsável pelo NutriAli combina com você o que fazer com os seus pacientes.'}
              </p>
              <label className="block text-xs font-medium text-red-900" htmlFor="deletion-reason">Motivo (opcional)</label>
              <textarea id="deletion-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2}
                className="w-full rounded-lg border border-red-200 bg-white p-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-100" />
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" onClick={requestDeletion} disabled={sending} className="gap-2 text-sm">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Confirmar pedido de exclusão
                </Button>
                <Button variant="outline" onClick={() => setConfirming(false)} disabled={sending} className="border-slate-300 text-sm">Cancelar</Button>
              </div>
            </div>
          ) : (
            <>
              {deletion?.status === 'kept' && (
                <p className="text-xs text-slate-500">O seu pedido anterior foi analisado em {day(deletion.decidedAt || '')} e a conta foi mantida. Se quiser, peça de novo.</p>
              )}
              <Button variant="outline" onClick={() => setConfirming(true)} className="gap-2 border-red-200 text-sm text-red-700 hover:bg-red-50">
                <Trash2 className="h-4 w-4" />
                Pedir exclusão da conta
              </Button>
            </>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </CardContent>
    </Card>
  );
}
