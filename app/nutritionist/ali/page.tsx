'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Bot, CalendarCheck, CheckCircle2, FileSpreadsheet, Loader2, Mail, Plus, Save, Trash2, Unplug, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, Button } from '@/components/ui';
import { useAuth } from '@/components/auth-provider';
import { auth } from '@/lib/firebase';
import { ALI_LIMITS, MAX_CONTACTS, WEEKDAY_NAMES, defaultAliSettings, describeAttendance, sanitizeContacts, type AliContact, type AliSettings, type ConsultationMode } from '@/lib/ali-settings';

interface GoogleStatus { configured: boolean; connected: boolean; email: string; needsReconnect: boolean; sheets: boolean }

const GOOGLE_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  conectado: { ok: true, text: 'Google conectado! A Ali já pode usar a sua agenda e o seu Gmail com os seus pacientes e criar planilhas para você.' },
  'conectado-sem-planilhas': { ok: false, text: 'Google conectado, mas sem a permissão das planilhas: a Ali usa a sua agenda e o seu Gmail, mas não cria planilhas. Para liberar, clique em Conectar de novo e deixe a permissão das planilhas marcada.' },
  cancelado: { ok: false, text: 'A conexão com o Google foi cancelada. Nada foi alterado.' },
  permissoes: { ok: false, text: 'Para a Ali funcionar, marque as permissões da agenda e do envio de e-mail (e a das planilhas, se quiser que ela crie planilhas) e conecte de novo.' },
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
  const [contacts, setContacts] = useState<AliContact[]>([]);
  const [newContact, setNewContact] = useState<AliContact>({ name: '', email: '' });
  const [contactError, setContactError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api('/api/nutritionist/ali-settings');
      setSettings(data.settings);
      setGoogle(data.google);
      setContacts(Array.isArray(data.contacts) ? data.contacts : []);
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

  const addContact = () => {
    // A mesma validação do servidor: o contato só entra se o nome e o e-mail forem válidos e novos.
    const [valid] = sanitizeContacts([newContact]);
    if (!valid) { setContactError('Preencha o nome e um e-mail válido.'); return; }
    if (contacts.some((contact) => contact.email === valid.email)) { setContactError('Esse e-mail já está na lista.'); return; }
    if (contacts.length >= MAX_CONTACTS) { setContactError(`A lista aceita até ${MAX_CONTACTS} contatos.`); return; }
    setContacts([...contacts, valid]);
    setNewContact({ name: '', email: '' });
    setContactError('');
  };

  const save = async () => {
    setSaving(true);
    setNotice(null);
    try {
      const data = await api('/api/nutritionist/ali-settings', { method: 'PUT', body: JSON.stringify({ settings, contacts }) });
      setSettings(data.settings);
      setContacts(Array.isArray(data.contacts) ? data.contacts : []);
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
          <CardTitle className="flex items-center gap-2"><CalendarCheck className="w-5 h-5 text-teal-600" /> Google: Agenda, Gmail e Planilhas</CardTitle>
          <CardDescription>
            Com o seu Google conectado, a Ali vê seus horários livres, marca a consulta com link do Meet, manda a confirmação
            e o plano por e-mail a partir do seu Gmail e te avisa de cada pedido. Quando você pede, ela também cria planilhas no seu
            Google Planilhas (pacientes, evolução do peso, plano alimentar e agenda); o NutriAli só mexe nas planilhas que ele mesmo cria.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {google?.connected ? (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <p className="text-sm text-slate-700 flex items-center gap-2">
                  <Mail className="w-4 h-4 text-teal-600 shrink-0" /> Conectado como <strong className="break-all">{google.email || 'sua conta Google'}</strong>
                </p>
                <Button variant="outline" onClick={disconnectGoogle} className="text-sm gap-2"><Unplug className="w-4 h-4" /> Desconectar</Button>
              </div>
              {google.sheets ? (
                <p className="text-sm text-slate-700 flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-teal-600 shrink-0" /> Planilhas liberadas: é só pedir para a Ali.
                </p>
              ) : (
                // Conexões feitas antes das planilhas (ou sem essa permissão marcada) precisam conectar de novo.
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
                  <p className="text-sm text-amber-900 flex items-start gap-2">
                    <FileSpreadsheet className="w-4 h-4 shrink-0 mt-0.5" />
                    A Ali agora também cria planilhas no seu Google Planilhas. Para liberar, conecte o Google de novo e deixe a permissão das planilhas marcada.
                  </p>
                  <Button onClick={connect} disabled={connecting || !google.configured} className="gap-2 w-full sm:w-auto text-sm">
                    {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
                    Conectar de novo e liberar as planilhas
                  </Button>
                </div>
              )}
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

      <Card>
        <CardHeader>
          <CardTitle>Contatos da sua Ali</CardTitle>
          <CardDescription>
            A sua Ali (o botão &ldquo;Ali&rdquo; no canto da tela) manda e-mails e convites a seu pedido, mas só para os seus
            pacientes e para os contatos desta lista. Ex.: laboratório, outro profissional.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {contacts.length > 0 && (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white/70">
              {contacts.map((contact) => (
                <li key={contact.email} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{contact.name}</p>
                    <p className="text-xs text-slate-500 truncate">{contact.email}</p>
                  </div>
                  <button type="button" onClick={() => setContacts(contacts.filter((c) => c.email !== contact.email))}
                    aria-label={`Remover ${contact.name}`} className="shrink-0 p-2 rounded-lg text-red-500 hover:bg-red-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 sm:items-end">
            <div>
              <label htmlFor="contact-name" className={labelClass}>Nome</label>
              <input id="contact-name" className={inputClass} maxLength={ALI_LIMITS.name} value={newContact.name}
                placeholder="Ex.: Laboratório Vida" onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} />
            </div>
            <div>
              <label htmlFor="contact-email" className={labelClass}>E-mail</label>
              <input id="contact-email" type="email" className={inputClass} maxLength={254} value={newContact.email}
                placeholder="contato@exemplo.com" onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} />
            </div>
            <Button type="button" variant="outline" onClick={addContact} className="gap-2 h-[42px]"><Plus className="w-4 h-4" /> Adicionar</Button>
          </div>
          {contactError && <p role="alert" className="text-sm text-red-700">{contactError}</p>}
          <p className="text-xs text-slate-500">A lista só é guardada quando você clica em Salvar configurações.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resumo semanal</CardTitle>
          <CardDescription>
            Toda segunda de manhã você recebe no seu Gmail as consultas da semana, quem anotou refeições e peso e quem
            está há dias sem abrir o app. Precisa do Google conectado.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <label className="flex items-center gap-3 text-sm text-slate-700 cursor-pointer">
            <input type="checkbox" className="h-5 w-5 shrink-0 rounded border-slate-300 accent-teal-600" checked={settings.weeklySummary}
              onChange={(e) => update('weeklySummary', e.target.checked)} />
            Receber o resumo semanal por e-mail
          </label>
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
