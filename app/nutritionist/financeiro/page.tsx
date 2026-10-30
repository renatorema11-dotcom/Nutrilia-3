'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Wallet } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from '@/components/ui';
import { ApiError, authFetch, postJson } from '@/lib/api-client';

interface Totals { count: number; gross: number; nutritionist: number; commission: number }
interface PaymentRow {
  id: string; patientName: string; appointmentDate: string; appointmentTime: string; value: number;
  status: string; nutritionistAmount: number; commission: number; exact: boolean;
}
interface Finance {
  price: number | null; enabled: boolean; walletLinked: boolean; subaccount: boolean; configured: boolean;
  month: Totals; total: Totals; payments: PaymentRow[];
}

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dateBr = (date: string) => (/^\d{4}-\d{2}-\d{2}$/.test(date) ? date.split('-').reverse().join('/') : date);
const STATUS: Record<string, { label: string; variant: 'default' | 'success' | 'warning' }> = {
  paid: { label: 'Paga', variant: 'success' },
  pending: { label: 'Aguardando pagamento', variant: 'warning' },
  refunded: { label: 'Estornada', variant: 'default' },
};
const COMPANY_TYPES = [['MEI', 'MEI'], ['LIMITED', 'Limitada (Ltda.)'], ['INDIVIDUAL', 'Individual (EI)'], ['ASSOCIATION', 'Associação']];

/** Financeiro da nutricionista: valor da consulta, conta para receber no Asaas e os pagamentos recebidos pelo app. */
export default function FinancePage() {
  const { user } = useAuth();
  const [finance, setFinance] = useState<Finance | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [price, setPrice] = useState('');
  const [mode, setMode] = useState<'criar' | 'carteira'>('criar');
  const [walletId, setWalletId] = useState('');
  const [form, setForm] = useState({ document: '', birthDate: '', companyType: 'MEI', mobilePhone: '', incomeValue: '', postalCode: '', address: '', addressNumber: '', complement: '', province: '' });
  const isCompany = form.document.replace(/\D/g, '').length > 11;

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/nutritionist/payments', { cache: 'no-store' });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError(typeof data?.error === 'string' ? data.error : 'Não foi possível carregar agora.'); return; }
      setFinance(data);
      if (typeof data.price === 'number') setPrice(data.price.toFixed(2).replace('.', ','));
    } catch {
      setError('Não foi possível carregar agora.');
    }
  }, []);

  useEffect(() => { if (user) load(); }, [user, load]);

  const send = async (key: string, body: Record<string, unknown>, done: string) => {
    if (busy) return;
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await postJson('/api/nutritionist/payments', body);
      setNotice(done);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar agora.');
    } finally {
      setBusy('');
    }
  };

  const update = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  if (!finance) {
    return (
      <div className="p-8 text-center text-slate-500">
        {error ? <p role="alert" className="text-red-700">{error}</p> : <Loader2 className="w-6 h-6 animate-spin mx-auto text-teal-600" />}
      </div>
    );
  }

  const card = (label: string, value: string, hint: string) => (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
        <p className="text-xs text-slate-500 mt-1">{hint}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2"><Wallet className="w-6 h-6 text-teal-600" /> Financeiro</h1>
        <p className="text-slate-600 mt-1">
          Receba as consultas pelo app. Você não paga mensalidade: o NutriAli fica com 10% de cada pagamento e o resto vai direto para a sua conta no Asaas.
        </p>
      </div>

      {!finance.configured && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">O pagamento pelo app ainda está sendo configurado. Você já pode deixar o valor da consulta salvo.</p>
      )}
      {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {card('Você recebeu no mês', money(finance.month.nutritionist), `${finance.month.count} consulta(s) paga(s) pelo app`)}
        {card('Comissão do NutriAli no mês', money(finance.month.commission), '10% do valor líquido de cada pagamento')}
        {card('Total recebido pelo app', money(finance.total.nutritionist), `${finance.total.count} consulta(s) desde o início`)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Valor da consulta</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Input id="consulta-valor" label="Valor cobrado do paciente (R$)" placeholder="150,00" value={price} onChange={(e) => setPrice(e.target.value)} />
            <Button onClick={() => send('preco', { action: 'preco', price }, 'Valor da consulta salvo.')} disabled={!!busy || !price}>
              {busy === 'preco' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Salvar valor
            </Button>
            <p className="text-xs text-slate-500">Com o valor e a conta para receber, os seus pacientes veem o botão &quot;Pagar consulta&quot; em cada consulta marcada.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Conta para receber</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {finance.walletLinked ? (
              <div className="space-y-2">
                <p className="font-semibold text-emerald-800 flex items-center gap-2"><CheckCircle2 className="w-5 h-5" /> Conta ativa no Asaas</p>
                <p className="text-sm text-slate-600">
                  {finance.subaccount
                    ? 'O Asaas enviou para o seu e-mail o acesso à sua conta, onde você acompanha os valores e faz os saques.'
                    : 'Os pagamentos caem na conta do Asaas que você informou.'}
                </p>
              </div>
            ) : (
              <>
                <div className="flex bg-slate-100 p-1 rounded-lg text-sm font-medium">
                  <button type="button" onClick={() => setMode('criar')} className={`flex-1 rounded-md py-1.5 ${mode === 'criar' ? 'bg-white shadow-sm text-teal-700' : 'text-slate-600'}`}>Criar minha conta</button>
                  <button type="button" onClick={() => setMode('carteira')} className={`flex-1 rounded-md py-1.5 ${mode === 'carteira' ? 'bg-white shadow-sm text-teal-700' : 'text-slate-600'}`}>Já tenho conta no Asaas</button>
                </div>
                {mode === 'criar' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input id="conta-doc" label="CPF ou CNPJ" value={form.document} onChange={update('document')} className="sm:col-span-2" />
                    {isCompany ? (
                      <div className="space-y-1 sm:col-span-2">
                        <label htmlFor="conta-tipo" className="block text-sm font-medium text-slate-700">Tipo da empresa</label>
                        <select id="conta-tipo" value={form.companyType} onChange={(e) => setForm({ ...form, companyType: e.target.value })}
                          className="w-full rounded-lg bg-white border border-slate-300 px-3 py-2 text-slate-900 h-[42px]">
                          {COMPANY_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </div>
                    ) : (
                      <Input id="conta-nascimento" label="Data de nascimento" type="date" value={form.birthDate} onChange={update('birthDate')} />
                    )}
                    <Input id="conta-celular" label="Celular com DDD" value={form.mobilePhone} onChange={update('mobilePhone')} />
                    <Input id="conta-renda" label={isCompany ? 'Faturamento mensal (R$)' : 'Renda mensal (R$)'} value={form.incomeValue} onChange={update('incomeValue')} />
                    <Input id="conta-cep" label="CEP" value={form.postalCode} onChange={update('postalCode')} />
                    <Input id="conta-rua" label="Rua" value={form.address} onChange={update('address')} className="sm:col-span-2" />
                    <Input id="conta-numero" label="Número" value={form.addressNumber} onChange={update('addressNumber')} />
                    <Input id="conta-complemento" label="Complemento" value={form.complement} onChange={update('complement')} />
                    <Input id="conta-bairro" label="Bairro" value={form.province} onChange={update('province')} className="sm:col-span-2" />
                    <Button onClick={() => send('conta', { action: 'conta', ...form }, 'Conta criada no Asaas. Confira o seu e-mail para acessar a conta.')} disabled={!!busy || !finance.configured} className="sm:col-span-2">
                      {busy === 'conta' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Criar minha conta para receber
                    </Button>
                    <p className="text-xs text-slate-500 sm:col-span-2">Os dados vão só para o Asaas, que é a instituição que guarda e repassa o dinheiro. O NutriAli guarda apenas o código da sua conta.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <Input id="conta-wallet" label="Wallet ID da sua conta no Asaas" placeholder="0000aaaa-00aa-00aa-00aa-000000aaaaaa" value={walletId} onChange={(e) => setWalletId(e.target.value)} />
                    <Button onClick={() => send('carteira', { action: 'carteira', walletId }, 'Conta do Asaas ligada.')} disabled={!!busy || !walletId}>
                      {busy === 'carteira' && <Loader2 className="w-4 h-4 mr-2 animate-spin" />} Ligar minha conta
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Pagamentos de consultas</CardTitle></CardHeader>
        <CardContent>
          {finance.payments.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhum pagamento ainda. Quando um paciente pagar uma consulta pelo app, ele aparece aqui.</p>
          ) : (
            <div className="space-y-2">
              {finance.payments.map((row) => {
                const status = STATUS[row.status] || { label: row.status, variant: 'default' as const };
                return (
                  <div key={row.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 truncate">{row.patientName || 'Paciente'}</p>
                      <p className="text-xs text-slate-500">Consulta em {dateBr(row.appointmentDate)} às {row.appointmentTime} · {money(row.value)}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {row.status === 'paid' && (
                        <p className="text-sm text-slate-700">Você recebe <strong>{money(row.nutritionistAmount)}</strong>{row.exact ? '' : ' (estimado)'}</p>
                      )}
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-xs text-slate-500 mt-4">
            A taxa do Asaas (Pix, boleto ou cartão) é descontada antes da divisão: você recebe 90% do valor líquido e o NutriAli, 10%. Valores &quot;estimados&quot; ficam exatos quando o Asaas confirma o pagamento.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
