'use client';

import { useCallback, useEffect, useState } from 'react';
import { Brain, CheckCircle2, Loader2, Trash2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button } from '@/components/ui';
import { ApiError, authFetch, postJson } from '@/lib/api-client';

type Preference = { id: string; text: string; createdAt: string; source: 'ali' | 'app' };
type Followup = { id: string; text: string; patientName: string | null; dueDate: string | null; status: 'open' | 'done' };

const TEXT_MAX = 300;

const dayLabel = (key: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(`${key}T12:00:00Z`));

/**
 * Memória da Ali (o "segundo cérebro"): o jeito de trabalhar que a nutricionista pediu para lembrar e as pendências.
 * A Ali lê e grava isso nas conversas; aqui ela confere, acrescenta, conclui e apaga. Salva na hora, sem o botão da página.
 */
export function AliMemoryCard() {
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [today, setToday] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [prefText, setPrefText] = useState('');
  const [taskText, setTaskText] = useState('');
  const [taskDate, setTaskDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await authFetch('/api/nutritionist/ali-memory', { cache: 'no-store' }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok || !Array.isArray(data?.preferences) || !Array.isArray(data?.followups)) { setLoadError(true); return; }
    setPreferences(data.preferences);
    setFollowups(data.followups.filter((item: Followup) => item.status === 'open'));
    setToday(typeof data.today === 'string' ? data.today : '');
    setLoadError(false);
  }, []);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  const act = async (run: () => Promise<unknown>) => {
    if (busy) return false;
    setBusy(true);
    setError('');
    try {
      await run();
      await load();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar agora.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const addPreference = async (e: React.FormEvent) => {
    e.preventDefault();
    if (prefText.trim().length < 3) return;
    if (await act(() => postJson('/api/nutritionist/ali-memory', { kind: 'preference', text: prefText }))) setPrefText('');
  };

  const addFollowup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (taskText.trim().length < 3) return;
    if (await act(() => postJson('/api/nutritionist/ali-memory', { kind: 'followup', text: taskText, dueDate: taskDate || undefined }))) { setTaskText(''); setTaskDate(''); }
  };

  const send = (method: 'PATCH' | 'DELETE', id: string) => act(async () => {
    const res = method === 'PATCH'
      ? await authFetch('/api/nutritionist/ali-memory', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
      : await authFetch(`/api/nutritionist/ali-memory?id=${encodeURIComponent(id)}`, { method });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new ApiError(typeof data?.error === 'string' ? data.error : 'Não foi possível concluir agora.');
    }
  });

  const remove = (id: string) => { if (window.confirm('Apagar da memória da Ali? Não dá para desfazer.')) send('DELETE', id); };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Brain className="w-5 h-5 text-teal-600" /> Memória da Ali</CardTitle>
        <CardDescription>
          O que a Ali lembra sobre o seu jeito de trabalhar e as suas pendências. Ela anota quando você pede, por exemplo:
          &quot;lembre que eu prefiro planos com 5 refeições&quot; ou &quot;anote para cobrar o exame da Ana na sexta&quot;. Só você vê.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? <p className="text-sm text-slate-500">Carregando a memória...</p>
          : loadError ? <p role="alert" className="text-sm text-red-700">Não foi possível carregar a memória da Ali.</p>
          : (
            <>
              <section aria-labelledby="mem-prefs" className="space-y-2">
                <h3 id="mem-prefs" className="text-sm font-semibold text-slate-700">Seu jeito de trabalhar</h3>
                <p className="text-xs text-slate-500">Entra nas conversas e nos rascunhos de plano que a Ali monta. Não coloque dados de pacientes aqui.</p>
                {preferences.length ? (
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                    {preferences.map((item) => (
                      <li key={item.id} className="flex items-start justify-between gap-2 px-3 py-2 text-sm text-slate-800">
                        <span>{item.text}</span>
                        <button type="button" onClick={() => remove(item.id)} disabled={busy} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Apagar" aria-label={`Apagar a preferência: ${item.text}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-slate-500">Nenhuma preferência anotada ainda.</p>}
                <form onSubmit={addPreference} className="flex flex-col gap-2 sm:flex-row">
                  <label htmlFor="mem-pref-text" className="sr-only">Nova preferência</label>
                  <input id="mem-pref-text" value={prefText} maxLength={TEXT_MAX} onChange={(e) => setPrefText(e.target.value)}
                    placeholder="Ex.: sempre incluir uma fruta no lanche da tarde"
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none" />
                  <Button type="submit" variant="outline" disabled={busy || prefText.trim().length < 3} className="h-10 text-sm">Lembrar</Button>
                </form>
              </section>

              <section aria-labelledby="mem-tasks" className="space-y-2">
                <h3 id="mem-tasks" className="text-sm font-semibold text-slate-700">Pendências</h3>
                {followups.length ? (
                  <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                    {followups.map((item) => {
                      const late = !!item.dueDate && !!today && item.dueDate < today;
                      return (
                        <li key={item.id} className="flex items-start justify-between gap-2 px-3 py-2 text-sm">
                          <div>
                            <p className="text-slate-800">{item.text}</p>
                            <p className={`text-xs ${late ? 'font-medium text-red-700' : 'text-slate-500'}`}>
                              {[item.patientName, item.dueDate ? `${late ? 'atrasada, era para ' : 'para '}${dayLabel(item.dueDate)}` : 'sem prazo'].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <button type="button" onClick={() => send('PATCH', item.id)} disabled={busy} className="rounded p-1 text-slate-400 hover:bg-emerald-50 hover:text-emerald-700" title="Concluir" aria-label={`Concluir: ${item.text}`}>
                              <CheckCircle2 className="h-4 w-4" />
                            </button>
                            <button type="button" onClick={() => remove(item.id)} disabled={busy} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Apagar" aria-label={`Apagar: ${item.text}`}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="text-sm text-slate-500">Nenhuma pendência aberta.</p>}
                <form onSubmit={addFollowup} className="flex flex-col gap-2 sm:flex-row">
                  <label htmlFor="mem-task-text" className="sr-only">Nova pendência</label>
                  <input id="mem-task-text" value={taskText} maxLength={TEXT_MAX} onChange={(e) => setTaskText(e.target.value)}
                    placeholder="Ex.: ligar para o laboratório"
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none" />
                  <label htmlFor="mem-task-date" className="sr-only">Prazo (opcional)</label>
                  <input id="mem-task-date" type="date" value={taskDate} min={today || undefined} onChange={(e) => setTaskDate(e.target.value)}
                    className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-teal-400 focus:outline-none" />
                  <Button type="submit" variant="outline" disabled={busy || taskText.trim().length < 3} className="h-10 text-sm">Anotar</Button>
                </form>
                <p className="text-xs text-slate-500">Pendência de um paciente: peça para a Ali, por exemplo &quot;anote para pedir o exame da Ana até sexta&quot;.</p>
              </section>
              {busy && <p className="flex items-center gap-1 text-xs text-slate-500"><Loader2 className="h-3 w-3 animate-spin" /> Salvando...</p>}
              {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            </>
          )}
      </CardContent>
    </Card>
  );
}
