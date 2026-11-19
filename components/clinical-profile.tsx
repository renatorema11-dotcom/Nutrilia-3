'use client';

import { useEffect, useState } from 'react';
import { Loader2, Lock, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Button } from '@/components/ui';
import { ApiError, authFetch } from '@/lib/api-client';

type ListKey = 'allergies' | 'intolerances' | 'restrictions' | 'dislikes' | 'preferences' | 'conditions' | 'medications' | 'supplements';
type Profile = Record<ListKey, string[]> & { sex: 'F' | 'M' | null; activity: string | null; notes: string; updatedAt: string | null; updatedBy: 'app' | 'ali' | null };

// Os mesmos campos e limites de lib/clinical-profile.ts (o servidor confere de novo ao salvar).
const LISTS: { key: ListKey; label: string; placeholder: string; alert?: boolean }[] = [
  { key: 'allergies', label: 'Alergias', placeholder: 'Ex.: amendoim', alert: true },
  { key: 'intolerances', label: 'Intolerâncias', placeholder: 'Ex.: lactose', alert: true },
  { key: 'restrictions', label: 'Restrições alimentares', placeholder: 'Ex.: vegetariano', alert: true },
  { key: 'dislikes', label: 'Não gosta de', placeholder: 'Ex.: berinjela' },
  { key: 'preferences', label: 'Preferências', placeholder: 'Ex.: café sem açúcar' },
  { key: 'conditions', label: 'Condições de saúde', placeholder: 'Ex.: hipertensão' },
  { key: 'medications', label: 'Medicamentos', placeholder: 'Ex.: losartana' },
  { key: 'supplements', label: 'Suplementos', placeholder: 'Ex.: vitamina D' },
];
const ACTIVITY = [
  { value: 'sedentario', label: 'Sedentário' }, { value: 'leve', label: 'Leve' }, { value: 'moderado', label: 'Moderado' },
  { value: 'intenso', label: 'Intenso' }, { value: 'muito_intenso', label: 'Muito intenso' },
];
const ITEM_MAX = 80;
const PER_LIST = 20;
const NOTES_MAX = 1000;

const emptyProfile = (): Profile => ({
  allergies: [], intolerances: [], restrictions: [], dislikes: [], preferences: [], conditions: [], medications: [], supplements: [],
  sex: null, activity: null, notes: '', updatedAt: null, updatedBy: null,
});

/** Ficha clínica no prontuário: o que a Ali usa para montar e conferir os planos e para avisar antes da consulta. */
export function ClinicalProfile({ patientId }: { patientId: string }) {
  return patientId ? <ProfileForPatient key={patientId} patientId={patientId} /> : null;
}

function ProfileForPatient({ patientId }: { patientId: string }) {
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [drafts, setDrafts] = useState<Partial<Record<ListKey, string>>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    authFetch(`/api/nutritionist/clinical-profile?patientId=${encodeURIComponent(patientId)}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!active) return;
        if (!res.ok || !data?.profile) throw new Error('falha');
        setProfile({ ...emptyProfile(), ...data.profile });
        setLoadError(false);
      })
      .catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [patientId]);

  const change = (next: Partial<Profile>) => {
    setProfile((current) => ({ ...current, ...next }));
    setDirty(true);
    setMessage('');
  };

  /** A lista com o que foi digitado: "amendoim, camarão" vira dois itens, para a conferência do plano achar cada um. */
  const withTyped = (list: string[], typed: string): { list: string[]; full: boolean } => {
    const next = [...list];
    for (const part of typed.split(/[,;]/)) {
      const text = part.replace(/\s+/g, ' ').trim().slice(0, ITEM_MAX);
      if (text.length < 2 || next.some((item) => item.toLowerCase() === text.toLowerCase())) continue;
      if (next.length >= PER_LIST) return { list: next, full: true };
      next.push(text);
    }
    return { list: next, full: false };
  };

  const addItem = (key: ListKey) => {
    const typed = drafts[key] || '';
    if (typed.trim().length < 2) return;
    const { list, full } = withTyped(profile[key], typed);
    if (list.length !== profile[key].length) change({ [key]: list } as Partial<Profile>);
    setDrafts((current) => ({ ...current, [key]: '' }));
    setError(full ? `Cada lista aceita até ${PER_LIST} itens.` : '');
  };

  const save = async () => {
    if (saving) return;
    // O que ficou digitado sem clicar em Acrescentar também vai: senão a tela diria "Ficha salva" sem ele.
    const toSave = { ...profile };
    for (const list of LISTS) if ((drafts[list.key] || '').trim().length >= 2) toSave[list.key] = withTyped(toSave[list.key], drafts[list.key] || '').list;
    setSaving(true);
    setError('');
    try {
      const res = await authFetch('/api/nutritionist/clinical-profile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId, profile: toSave, expectedUpdatedAt: profile.updatedAt }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 409 && data?.profile) {
        // A Ali (ou outra aba) mudou a ficha: mostra a versão atual para ela conferir antes de salvar de novo.
        setProfile({ ...emptyProfile(), ...data.profile });
        setDirty(false);
        setError(typeof data.error === 'string' ? data.error : 'A ficha mudou enquanto você editava. Confira e salve de novo.');
        return;
      }
      if (!res.ok || !data?.profile) throw new ApiError(typeof data?.error === 'string' ? data.error : 'Não foi possível salvar a ficha agora.');
      setProfile({ ...emptyProfile(), ...data.profile });
      setDrafts({});
      setDirty(false);
      setMessage('Ficha salva.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar a ficha agora.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Ficha clínica</CardTitle>
        <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
          <Lock className="h-3.5 w-3.5" /> Só você vê. A Ali usa a ficha para montar e conferir os planos e para avisar antes da consulta.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? <p className="text-sm text-slate-500">Carregando a ficha...</p>
          : loadError ? <p role="alert" className="text-sm text-red-700">Não foi possível carregar a ficha.</p>
          : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-medium text-slate-600">
                  Sexo (para as contas de energia)
                  <select value={profile.sex || ''} onChange={(e) => change({ sex: (e.target.value || null) as Profile['sex'] })}
                    className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-800 focus:border-emerald-400 focus:outline-none">
                    <option value="">Não informado</option>
                    <option value="F">Feminino</option>
                    <option value="M">Masculino</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-slate-600">
                  Nível de atividade física
                  <select value={profile.activity || ''} onChange={(e) => change({ activity: e.target.value || null })}
                    className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm text-slate-800 focus:border-emerald-400 focus:outline-none">
                    <option value="">Não informado</option>
                    {ACTIVITY.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {LISTS.map((list) => (
                  <div key={list.key}>
                    <p className={`text-xs font-medium ${list.alert ? 'text-amber-700' : 'text-slate-600'}`}>{list.label}</p>
                    <ul className="mt-1 flex flex-wrap gap-1.5">
                      {profile[list.key].map((item) => (
                        <li key={item} className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${list.alert ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>
                          {item}
                          <button type="button" aria-label={`Tirar ${item}`} title="Tirar"
                            onClick={() => change({ [list.key]: profile[list.key].filter((other) => other !== item) } as Partial<Profile>)}
                            className="rounded-full p-0.5 hover:bg-white/70">
                            <X className="h-3 w-3" />
                          </button>
                        </li>
                      ))}
                      {!profile[list.key].length && <li className="text-xs text-slate-400">Nada anotado.</li>}
                    </ul>
                    <form className="mt-1.5 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); addItem(list.key); }}>
                      <label htmlFor={`clin-${list.key}-${patientId}`} className="sr-only">Acrescentar em {list.label}</label>
                      <input id={`clin-${list.key}-${patientId}`} value={drafts[list.key] || ''} maxLength={ITEM_MAX} placeholder={list.placeholder}
                        onChange={(e) => setDrafts((current) => ({ ...current, [list.key]: e.target.value }))}
                        className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm focus:border-emerald-400 focus:outline-none" />
                      <Button type="submit" variant="outline" className="h-8 px-2 text-xs">Acrescentar</Button>
                    </form>
                  </div>
                ))}
              </div>

              <div>
                <label htmlFor={`clin-notes-${patientId}`} className="text-xs font-medium text-slate-600">Observações</label>
                <textarea id={`clin-notes-${patientId}`} value={profile.notes} maxLength={NOTES_MAX} rows={3}
                  onChange={(e) => change({ notes: e.target.value })}
                  placeholder="Ex.: exames de outubro com vitamina D baixa; trabalha em turnos."
                  className="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100" />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-slate-400">
                  {profile.updatedAt ? `Atualizada em ${new Date(profile.updatedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}${profile.updatedBy === 'ali' ? ' pela Ali' : ''}.` : 'Ficha ainda não preenchida.'}
                  {' '}Você também pode ditar para a Ali: &quot;anote que a Ana tem alergia a amendoim&quot;.
                </p>
                <Button type="button" onClick={save} disabled={saving || (!dirty && !LISTS.some((list) => (drafts[list.key] || '').trim().length >= 2))} className="h-8 bg-emerald-600 px-3 text-xs text-white hover:bg-emerald-700">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Salvar ficha'}
                </Button>
              </div>
              {message && <p role="status" className="text-xs text-emerald-700">{message}</p>}
              {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
            </>
          )}
      </CardContent>
    </Card>
  );
}
