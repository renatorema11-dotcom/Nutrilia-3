'use client';

import { useState } from 'react';
import { CheckCircle2, Crown, Loader2, ShieldCheck, Sparkles } from 'lucide-react';
import { Button, Card, CardContent, Input } from '@/components/ui';
import { usePremium } from '@/components/premium';
import { ApiError, postJson } from '@/lib/api-client';
import { FREE_FEATURES, PREMIUM_FEATURES, PREMIUM_PRICE_LABEL, premiumUntil, validCpf } from '@/lib/premium';

const dateLabel = (date: Date | null) => (date ? date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) : '');

/** Plano Premium do paciente: o que ele libera, quanto custa, assinar e cancelar. O pagamento é feito no Asaas. */
export default function PremiumPage() {
  const { loading, active, premium } = usePremium();
  const [cpf, setCpf] = useState('');
  const [busy, setBusy] = useState<'' | 'assinar' | 'cancelar'>('');
  const [message, setMessage] = useState('');

  const subscribed = premium?.subscriptionActive === true;
  const until = premiumUntil(premium);
  const courtesy = typeof premium?.courtesyUntil === 'string' && Date.parse(premium.courtesyUntil) > Date.now();

  const subscribe = async () => {
    setMessage('');
    if (!validCpf(cpf)) {
      setMessage('Confira o CPF: o Asaas pede o CPF de quem paga.');
      return;
    }
    setBusy('assinar');
    try {
      const data = await postJson('/api/premium', { action: 'assinar', cpf });
      // O pagamento abre no site do Asaas; quando ele confirmar, o Premium liga sozinho nesta conta.
      window.location.href = data.invoiceUrl;
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível abrir o pagamento agora.');
      setBusy('');
    }
  };

  const cancel = async () => {
    if (!window.confirm(`Cancelar a assinatura? O Premium continua até ${dateLabel(until) || 'o fim do mês pago'}.`)) return;
    setMessage('');
    setBusy('cancelar');
    try {
      await postJson('/api/premium', { action: 'cancelar' });
      setMessage('Assinatura cancelada. Nada mais será cobrado.');
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : 'Não foi possível cancelar agora.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 flex items-center gap-1.5"><Crown className="w-4 h-4" /> <span translate="no">NutriAli Premium</span></p>
        <h1 className="text-2xl font-bold text-slate-800 mt-1">Mais recursos para o seu acompanhamento</h1>
        <p className="text-slate-600 mt-1">O seu plano, o chat com a nutricionista e a Ali continuam grátis. O Premium soma as funções abaixo.</p>
      </div>

      {active && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
          <p className="font-semibold flex items-center gap-2"><CheckCircle2 className="w-5 h-5" /> Seu Premium está ativo{until ? ` até ${dateLabel(until)}` : ''}.</p>
          <p className="text-sm mt-1">
            {subscribed ? 'A assinatura renova todo mês; a próxima cobrança chega por e-mail perto do vencimento.'
              : courtesy ? 'É um Premium de cortesia do NutriAli.' : 'A assinatura foi cancelada: o Premium vale até o fim do mês pago.'}
          </p>
        </div>
      )}

      <Card>
        <CardContent className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-slate-700">Plano mensal</p>
              <p><span className="text-4xl font-extrabold text-slate-900">{PREMIUM_PRICE_LABEL}</span><span className="text-slate-500 font-medium">/mês</span></p>
            </div>
            <p className="text-sm text-slate-500">Sem fidelidade. Cancele quando quiser.</p>
          </div>

          <ul className="space-y-3">
            {PREMIUM_FEATURES.map((feature) => (
              <li key={feature.id} className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-slate-800">{feature.title}</p>
                  <p className="text-sm text-slate-600">{feature.text}</p>
                </div>
              </li>
            ))}
          </ul>

          {!loading && !active && (
            <div className="space-y-3 border-t border-slate-200 pt-5">
              <Input id="cpf" label="CPF de quem vai pagar" placeholder="000.000.000-00" maxLength={14} value={cpf} onChange={(e) => setCpf(e.target.value)} />
              <Button onClick={subscribe} disabled={!!busy} className="w-full bg-amber-600 hover:bg-amber-700 text-white gap-2">
                {busy === 'assinar' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crown className="w-4 h-4" />}
                {subscribed ? 'Abrir o pagamento em aberto' : `Assinar por ${PREMIUM_PRICE_LABEL}/mês`}
              </Button>
              <p className="text-xs text-slate-500 flex items-start gap-1.5">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                O pagamento é feito no site seguro do Asaas, por Pix, cartão ou boleto. O CPF vai só para o Asaas, para a cobrança. O Premium liga assim que o pagamento é confirmado (no Pix, na hora).
              </p>
            </div>
          )}

          {active && subscribed && (
            <Button variant="outline" onClick={cancel} disabled={!!busy} className="w-full sm:w-auto">
              {busy === 'cancelar' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Cancelar a assinatura
            </Button>
          )}

          {message && <p role="status" className="text-sm font-medium text-slate-700">{message}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <p className="font-semibold text-slate-800 mb-3">Sempre grátis</p>
          <ul className="grid sm:grid-cols-2 gap-2">
            {FREE_FEATURES.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-slate-700"><CheckCircle2 className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" /> {item}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
