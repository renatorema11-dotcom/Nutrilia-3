'use client';

import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from './auth-provider';

type AppointmentRequest = { id: string; patientName: string; preferredDate: string; notes: string; status: string };

export function AliAppointmentRequests({ isNutritionist }: { isNutritionist: boolean }) {
  const { user } = useAuth();
  return user ? <RequestsForUser key={`${user.uid}:${isNutritionist}`} uid={user.uid} isNutritionist={isNutritionist} /> : null;
}

function RequestsForUser({ uid, isNutritionist }: { uid: string; isNutritionist: boolean }) {
  const [requests, setRequests] = useState<AppointmentRequest[]>([]);
  const [error, setError] = useState(false);
  useEffect(() => {
    // Solicitações chegam pelo n8n; o painel precisa refletir a chegada em tempo real.
    const q = query(collection(db, 'appointmentRequests'),
      where(isNutritionist ? 'nutritionistId' : 'patientUid', '==', uid),
      orderBy('createdAt', 'desc'), limit(30));
    return onSnapshot(q, snapshot => {
      setRequests(snapshot.docs.map(item => ({ ...item.data(), id: item.id } as AppointmentRequest)));
      setError(false);
    }, () => { setRequests([]); setError(true); });
  }, [uid, isNutritionist]);
  return <section className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3" aria-label="Solicitações da Ali">
    <h4 className="font-semibold text-amber-900">Solicitações da Ali</h4>
    <p className="text-xs text-amber-900">O pedido só vira consulta agendada após a confirmação do nutricionista.</p>
    {error ? <p role="alert" className="text-sm text-red-700">Não foi possível carregar as solicitações.</p>
      : requests.length === 0 ? <p className="text-sm text-slate-600">Nenhuma solicitação registrada.</p>
      : <ul className="space-y-2">{requests.map(request => <li key={request.id} className="rounded-lg bg-white p-3 text-sm">
        {isNutritionist && <p className="font-semibold">{request.patientName}</p>}
        <p>Preferência: {request.preferredDate}</p>
        {request.notes && <p className="whitespace-pre-wrap text-slate-600">{request.notes}</p>}
        <p className="mt-1 text-xs font-medium text-amber-800">{request.status === 'pending' ? 'Aguardando confirmação' : request.status === 'confirmed' ? 'Confirmada' : request.status === 'cancelled' ? 'Cancelada' : 'Em análise'}</p>
      </li>)}</ul>}
  </section>;
}
