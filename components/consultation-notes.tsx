'use client';

import { useEffect, useState } from 'react';
import { Loader2, Lock, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, Button } from '@/components/ui';
import { ApiError, authFetch, postJson } from '@/lib/api-client';

type Note = { id: string; text: string; createdAt: string; source: 'app' | 'ali' };

const NOTE_MAX = 4000;

/** Anotações das consultas no prontuário: só a nutricionista vê; dá para escrever aqui ou ditar para a Ali. */
export function ConsultationNotes({ patientId }: { patientId: string }) {
  return patientId ? <NotesForPatient key={patientId} patientId={patientId} /> : null;
}

function NotesForPatient({ patientId }: { patientId: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    authFetch(`/api/nutritionist/consultation-notes?patientId=${encodeURIComponent(patientId)}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!active) return;
        if (!res.ok || !Array.isArray(data?.notes)) throw new Error('falha');
        setNotes(data.notes);
        setLoadError(false);
      })
      .catch(() => { if (active) setLoadError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [patientId]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim().length < 3 || saving) return;
    setSaving(true);
    setError('');
    try {
      const data = await postJson('/api/nutritionist/consultation-notes', { patientId, text });
      setNotes((list) => [data.note as Note, ...list]);
      setText('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar a anotação agora.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (note: Note) => {
    if (!window.confirm('Apagar esta anotação? Não dá para desfazer.')) return;
    setError('');
    const res = await authFetch(`/api/nutritionist/consultation-notes?id=${encodeURIComponent(note.id)}`, { method: 'DELETE' }).catch(() => null);
    if (res && res.ok) setNotes((list) => list.filter((item) => item.id !== note.id));
    else setError('Não foi possível apagar a anotação agora.');
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Anotações das consultas</CardTitle>
        <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
          <Lock className="h-3.5 w-3.5" /> Só você vê. O paciente não tem acesso. Você também pode ditar para a Ali.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={save} className="space-y-2">
          <label htmlFor={`note-${patientId}`} className="sr-only">Nova anotação</label>
          <textarea
            id={`note-${patientId}`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={NOTE_MAX}
            rows={3}
            placeholder="Ex.: relatou mais fome à noite; combinamos trocar o lanche da tarde."
            className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-400">{text.length}/{NOTE_MAX}</span>
            <Button type="submit" disabled={saving || text.trim().length < 3} className="h-8 bg-emerald-600 px-3 text-xs text-white hover:bg-emerald-700">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Salvar anotação'}
            </Button>
          </div>
          {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
        </form>

        {loading ? <p className="text-sm text-slate-500">Carregando anotações...</p>
          : loadError ? <p role="alert" className="text-sm text-red-700">Não foi possível carregar as anotações.</p>
          : notes.length === 0 ? <p className="text-sm text-slate-500">Nenhuma anotação ainda.</p>
          : <ul className="space-y-3 divide-y divide-slate-100">{notes.map((note) => (
            <li key={note.id} className="pt-3 first:pt-0">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs text-slate-400">
                  {new Date(note.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                  {note.source === 'ali' ? ' · ditada para a Ali' : ''}
                </p>
                <button type="button" onClick={() => remove(note)} className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600" title="Apagar anotação" aria-label="Apagar anotação">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{note.text}</p>
            </li>
          ))}</ul>}
      </CardContent>
    </Card>
  );
}
