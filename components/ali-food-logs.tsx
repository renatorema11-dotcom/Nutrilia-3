'use client';

import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';

type FoodLog = { id: string; description: string; mealTime: string; loggedAt: string };

/** "23/10/2026, 13:00": sem os segundos, que só poluíam a lista. */
function formatLoggedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function AliFoodLogs({ patientUid }: { patientUid: string }) {
  return patientUid ? <FoodLogsForPatient key={patientUid} patientUid={patientUid} /> : null;
}

function FoodLogsForPatient({ patientUid }: { patientUid: string }) {
  const [logs, setLogs] = useState<FoodLog[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    // Listener necessário: a Ali grava em outro serviço durante a conversa.
    return onSnapshot(query(collection(db, 'patients', patientUid, 'foodLogs'), orderBy('loggedAt', 'desc'), limit(30)), snapshot => {
      setLogs(snapshot.docs.map(item => ({ ...item.data(), id: item.id } as FoodLog)));
      setError(false);
    }, () => { setLogs([]); setError(true); });
  }, [patientUid]);
  return (
    <section className="rounded-xl border border-teal-100 bg-teal-50/50 p-4 space-y-3" aria-label="Refeições registradas com a Ali">
      <h3 className="font-semibold text-teal-900">Refeições registradas com a Ali</h3>
      {error ? <p role="alert" className="text-sm text-red-700">Não foi possível carregar os registros da Ali.</p>
        : logs.length === 0 ? <p className="text-sm text-slate-600">Nenhuma refeição registrada com a Ali.</p>
        : <ul className="space-y-3">{logs.map(log => <li key={log.id} className="rounded-lg bg-white p-3 text-sm">
          <p className="whitespace-pre-wrap text-slate-800">{log.description}</p>
          <p className="mt-1 text-xs text-slate-500">{[log.mealTime, formatLoggedAt(log.loggedAt)].filter(Boolean).join(' · ')}</p>
        </li>)}</ul>}
    </section>
  );
}
