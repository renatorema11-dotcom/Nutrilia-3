'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Bot, CalendarCheck, CheckCircle2, Loader2, Mail, Save, Unplug, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button } from '@/components/ui';
import { useAuth } from '@/components/auth-provider';
import { auth } from '@/lib/firebase';
import { ALI_LIMITS, WEEKDAY_NAMES, defaultAliSettings, describeAttendance, type AliSettings, type ConsultationMode } from '@/lib/ali-settings';

interface GoogleStatus { configured: boolean; connected: boolean; email: string; needsReconnect: boolean }

const GOOGLE_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  conectado: { ok: true, text: 'Google conectado! A Ali já pode usar a sua agenda e o seu Gmail com os seus pacientes.' },
  cancelado: { ok: false, text: 'A conexão com o Google foi cancelada. Nada foi alterado.' },
  permissoes: { ok: false, text: 'Para a Ali funcionar, marque todas as permissões pedidas (agenda e envio de e-mail) e conecte de novo.' },
  expirado: { ok: false, text: 'A conexão demorou ou foi aberta em outro navegador. Clique em Conectar Google de novo.' },
  'nao-configurado': { ok: false, text: 'A conexão com o Google ainda não foi ativada no servidor do NutriAli.' },
  erro: { ok: false, text: 'Não foi possível conectar o Google agora. Tente de novo em instantes.' },
};

const inputClass = 'w-full rounded-lg bg-white/80 border border-slate-200 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 shadow-sm';
const labelClass = 'block text-sm font-medium text-slate-700 mb-1';

async function api(path: string, init: RequestInit = {}) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('sessão');
  const res = await fetch(path, {
    ...init,
    headers: { ...(init.headers || {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Falha na comunicação.');
  return data;
}

function MinhaAliContent() {
  const { user } = useAuth();
  const params = useSearchParams();
  const [settings, setSettings] = useState<AliSettings>(defaultAliSettings());
  const [google, setGoogle] = useState<GoogleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(GOOGLE_MESSAGES[params.get('google') || ''] || null);

  const load = useCallback(async () => {
    try {
      const data = await api('/api/nutritionist/ali-settings');
      setSettings(data.settings);
      setGoogle(data.google);
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error && e.message !== 'sessão' ? e.message : 'Não foi possível carregar suas configurações.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const update = <K extends keyof AliSettings>(key: K, value: AliSettings[K]) => setSettings((s) => ({ ...s, [key]: value }));

  const toggleDay = (day: number) => update('workDays',
    settings.workDays.includes(day) ? settings.workDays.filter((d) => d !== day) : [...settings.workDays, day].sort((a, b) => a - b));

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const data = await api('/api/nutritionist/ali-settings', { method: 'PUT', body: JSON.stringify({ settings }) });
      setSettings(data.settings);
      setNotice({ ok: true, text: 'Configurações salvas. A Ali usa as novas informações a partir da próxima conversa.' });
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : 'Não foi possível salvar.' });
    } finally {
      setSaving(false);
    }
  };

  const connect = async () => {
    setConnecting(true);
    try {
      const data = await api('/api/google/connect', { method: 'POST' });
      window.location.href = data.url;
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : 'Não foi possível iniciar a conexão.' });
      setConnecting(false);
    }
  };

  const disconnectGoogle = async () => {
    if (!window.confirm('Desconectar o Google? A Ali deixa de marcar consultas na sua agenda e de enviar e-mails.')) return;
    try {
      await api('/api/google/disconnect', { method: 'POST' });
      setGoogle((g) => (g ? { ...g, connected: false, needsReconnect: false, email: '' } : g));
      setNotice({ ok: true, text: 'Google desconectado.' });
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : 'Não foi possível desconectar.' });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px] gap-2 text-slate-600">
        <Loader2 className="w-5 h-5 animate-spin text-teal-600" /> Carregando a sua Ali...
      </div>
    );
  }

  const greetingName = settings.displayName.trim() || 'sua nutricionista';

  return (
    <div className="space-y-6 pb-6 lg:pb-28">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2"><Bot className="w-6 h-6 text-teal-600" /> Minha Ali</h1>
        <p className="text-slate-600">Personalize a assistente de voz dos seus pacientes. Cada nutricionista tem a sua Ali.</p>
      </div>

      {notice && (
        <div role="status" className={`p-4 rounded-xl border text-sm flex items-start gap-2 ${notice.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
          {notice.ok ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertTriangle className="w-5 h-5 shrink-0" />}
          <span>{notice.text}</span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CalendarCheck className="w-5 h-5 text-teal-600" /> Google: Agenda e Gmail</CardTitle>
          <CardDescription>
            Com o seu Google conectado, a Ali vê seus horários livres, marca a consulta com link do Meet, manda a confirmação
            e o plano por e-mail a partir do seu Gmail e te avisa de cada pedido.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {google?.connected ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <p className="text-sm text-slate-700 flex items-center gap-2">
                <Mail className="w-4 h-4 text-teal-600 shrink-0" /> Conectado como <strong className="break-all">{google.email || 'sua conta Google'}</strong>
              </p>
              <Button variant="outline" onClick={disconnectGoogle} className="text-sm gap-2"><Unplug className="w-4 h-4" /> Desconectar</Button>
            </div>
          ) : (
            <div className="space-y-3">
              {google?.needsReconnect && (
                <p className="text-sm text-amber-800">A autorização do Google expirou. Conecte de novo para a Ali voltar a usar a sua agenda.</p>
              )}
              {google && !google.configured && (
                <p className="text-sm text-slate-600">A conexão com o Google está sendo ativada pelo NutriAli e fica disponível em breve.</p>
              )}
              <Button onClick={connect} disabled={connecting || !google?.configured} className="gap-2 w-full sm:w-auto">
                {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarCheck className="w-4 h-4" />}
                Conectar Google
              </Button>
              <p className="text-xs text-slate-500">Sem o Google conectado, a Ali continua registrando pedidos de consulta para você confirmar.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Como a Ali apresenta você</CardTitle>
          <CardDescription>O nome que a Ali usa com os seus pacientes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label htmlFor="ali-name" className={labelClass}>Seu nome para os pacientes</label>
            <input id="ali-name" className={inputClass} maxLength={ALI_LIMITS.name} value={settings.displayName}
              placeholder="Ex.: Dra. Carla Mendes" onChange={(e) => update('displayName', e.target.value)} />
          </div>
          <p className="text-sm text-slate-600 bg-teal-50 border border-teal-100 rounded-lg p-3">
            &ldquo;Oi! Eu sou a Ali e acompanho você junto com {greetingName}.&rdquo;
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Atendimento</CardTitle>
          <CardDescription>A Ali só oferece horários dentro disso e que estejam livres na sua agenda.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <span className={labelClass}>Dias de atendimento</span>
            <div className="flex flex-wrap gap-2">
              {WEEKDAY_NAMES.map((name, day) => {
                const active = settings.workDays.includes(day);
                return (
                  <button key={name} type="button" onClick={() => toggleDay(day)} aria-pressed={active}
                    className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${active ? 'bg-teal-600 text-white border-teal-600' : 'bg-white/70 text-slate-600 border-slate-200'}`}>
                    {name.slice(0, 3)}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ali-start" className={labelClass}>Começa às</label>
              <input id="ali-start" type="time" className={inputClass} value={settings.startTime} onChange={(e) => update('startTime', e.target.value)} />
            </div>
            <div>
              <label htmlFor="ali-end" className={labelClass}>Termina às</label>
              <input id="ali-end" type="time" className={inputClass} value={settings.endTime} onChange={(e) => update('endTime', e.target.value)} />
            </div>
            <div>
              <label htmlFor="ali-duration" className={labelClass}>Duração da consulta</label>
              <select id="ali-duration" className={inputClass} value={settings.durationMinutes} onChange={(e) => update('durationMinutes', Number(e.target.value))}>
                {[30, 40, 45, 50, 60, 75, 90].map((m) => <option key={m} value={m}>{m} minutos</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ali-interval" className={labelClass}>Intervalo entre consultas</label>
              <select id="ali-interval" className={inputClass} value={settings.intervalMinutes} onChange={(e) => update('intervalMinutes', Number(e.target.value))}>
                {[0, 5, 10, 15, 20, 30].map((m) => <option key={m} value={m}>{m === 0 ? 'Sem intervalo' : `${m} minutos`}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ali-notice" className={labelClass}>Antecedência mínima</label>
              <select id="ali-notice" className={inputClass} value={settings.minNoticeHours} onChange={(e) => update('minNoticeHours', Number(e.target.value))}>
                {[2, 6, 12, 24, 48, 72].map((h) => <option key={h} value={h}>{h} horas</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ali-horizon" className={labelClass}>Agenda aberta até</label>
              <select id="ali-horizon" className={inputClass} value={settings.horizonDays} onChange={(e) => update('horizonDays', Number(e.target.value))}>
                {[7, 14, 21, 30, 45, 60].map((d) => <option key={d} value={d}>{d} dias à frente</option>)}
              </select>
            </div>
          </div>
          <div>
            <span className={labelClass}>Tipo de consulta</span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {([['online', 'Online (Google Meet)'], ['presencial', 'Presencial'], ['ambos', 'Os dois']] as [ConsultationMode, string][]).map(([value, label]) => (
                <button key={value} type="button" onClick={() => update('mode', value)} aria-pressed={settings.mode === value}
                  className={`px-3 py-2 rounded-lg text-sm font-semibold border transition-colors ${settings.mode === value ? 'bg-teal-600 text-white border-teal-600' : 'bg-white/70 text-slate-600 border-slate-200'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-slate-500">A Ali vai dizer: {describeAttendance(settings)}.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Consultório</CardTitle>
          <CardDescription>A Ali responde com essas informações quando o paciente perguntar.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label htmlFor="ali-clinic" className={labelClass}>Nome do consultório</label>
            <input id="ali-clinic" className={inputClass} maxLength={ALI_LIMITS.clinic} value={settings.clinicName}
              placeholder="Ex.: Consultório Nutrir Bem" onChange={(e) => update('clinicName', e.target.value)} />
          </div>
          {settings.mode !== 'online' && (
            <div className="sm:col-span-2">
              <label htmlFor="ali-address" className={labelClass}>Endereço</label>
              <input id="ali-address" className={inputClass} maxLength={ALI_LIMITS.address} value={settings.address}
                placeholder="Rua, número, bairro, cidade" onChange={(e) => update('address', e.target.value)} />
            </div>
          )}
          <div>
            <label htmlFor="ali-price" className={labelClass}>Valor da consulta</label>
            <input id="ali-price" className={inputClass} maxLength={ALI_LIMITS.price} value={settings.price}
              placeholder="Ex.: R$ 180" onChange={(e) => update('price', e.target.value)} />
          </div>
          <div>
            <label htmlFor="ali-contact" className={labelClass}>Contato</label>
            <input id="ali-contact" className={inputClass} maxLength={ALI_LIMITS.contact} value={settings.contact}
              placeholder="Ex.: WhatsApp (11) 99999-0000" onChange={(e) => update('contact', e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Orientações para a Ali</CardTitle>
          <CardDescription>
            Como a Ali deve conversar com os seus pacientes e o que reforçar. Ela segue essas orientações, mas nunca prescreve
            nem muda o plano que você aprovou.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <textarea id="ali-guidelines" aria-label="Orientações para a Ali" className={`${inputClass} min-h-[120px]`} maxLength={ALI_LIMITS.guidelines}
            value={settings.guidelines} onChange={(e) => update('guidelines', e.target.value)}
            placeholder="Ex.: Seja bem motivadora. Lembre de beber água e de não pular o café da manhã. Meus pacientes têm foco em reeducação alimentar, sem dietas restritivas." />
          <p className="text-xs text-slate-500 text-right">{settings.guidelines.length}/{ALI_LIMITS.guidelines}</p>
        </CardContent>
      </Card>

      {/* No computador o botão flutuante da Ali fica no canto inferior direito: o Salvar vai para a esquerda. */}
      <div className="flex justify-end lg:justify-start">
        <Button onClick={save} disabled={saving} className="gap-2 w-full sm:w-auto h-11">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Salvar configurações
        </Button>
      </div>
    </div>
  );
}

export default function MinhaAliPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[300px]"><Loader2 className="w-6 h-6 animate-spin text-teal-600" /></div>}>
      <MinhaAliContent />
    </Suspense>
  );
}
