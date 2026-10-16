'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { MessageSquare } from 'lucide-react';
import { db } from '@/lib/firebase';
import { getUserData, updateUserData } from '@/lib/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { useAuth } from './auth-provider';

const READ_EVENT = 'nutriali:nutri-chat-read';

/** Marca a conversa com a nutricionista como lida: o servidor não manda e-mail sobre o que o paciente já viu. */
export async function markNutriChatRead(uid: string): Promise<void> {
  const at = new Date().toISOString();
  await updateUserData(uid, { nutriChatReadAt: at });
  window.dispatchEvent(new CustomEvent(READ_EVENT, { detail: at }));
}

/** Quantas mensagens da nutricionista chegaram depois da última leitura (ou da última resposta do paciente). */
export function useNutriUnread(): { unread: number; nutritionistName: string } {
  const { user } = useAuth();
  const [info, setInfo] = useState<{ chatId: string; name: string; readAt: string } | null>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    let active = true;
    getUserData(user.uid)
      .then((data) => {
        const nutritionistId = data?.patientData?.nutritionistId;
        if (!active || !nutritionistId) return;
        setInfo({
          chatId: `${user.uid}_${nutritionistId}`,
          name: data.patientData.nutritionistName || 'sua nutricionista',
          readAt: typeof data?.nutriChatReadAt === 'string' ? data.nutriChatReadAt : '',
        });
      })
      .catch(() => {});
    const onRead = (event: Event) => {
      const at = (event as CustomEvent<string>).detail;
      setInfo((current) => (current ? { ...current, readAt: at } : current));
    };
    window.addEventListener(READ_EVENT, onRead);
    return () => {
      active = false;
      window.removeEventListener(READ_EVENT, onRead);
    };
  }, [user]);

  useEffect(() => {
    if (!info) return;
    // Só as últimas mensagens: o que passou da última leitura ou resposta é o que conta como novo.
    const recent = query(collection(db, 'chats', info.chatId, 'messages'), orderBy('createdAt', 'desc'), limit(20));
    return onSnapshot(recent, (snap) => {
      let count = 0;
      for (const item of snap.docs) {
        const message = item.data();
        if (String(message.createdAt || '') <= info.readAt || message.senderRole === 'patient') break;
        if (message.senderRole === 'nutritionist') count++;
      }
      setUnread(count);
    }, () => setUnread(0));
  }, [info]);

  return { unread, nutritionistName: info?.name || '' };
}

/** Aviso no painel do paciente quando há mensagem nova da nutricionista. */
export function NutriMessagesBanner() {
  const { unread, nutritionistName } = useNutriUnread();
  if (!unread) return null;
  return (
    <Link
      href="/patient/chat?tab=nutritionist"
      className="flex items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900 shadow-sm hover:bg-teal-100"
    >
      <span className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 shrink-0" />
        {unread === 1 ? 'Você tem 1 mensagem nova' : `Você tem ${unread} mensagens novas`} de {nutritionistName}.
      </span>
      <span className="shrink-0 font-semibold">Abrir chat</span>
    </Link>
  );
}

/** Liga ou desliga os avisos por e-mail (mensagem nova, plano novo, resposta a pedido de consulta). */
export function EmailNoticesToggle() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    let active = true;
    getUserData(user.uid)
      .then((data) => { if (active) setEnabled(data?.emailNotices !== false); })
      .catch(() => { if (active) setEnabled(true); });
    return () => { active = false; };
  }, [user]);

  const toggle = async () => {
    if (!user || enabled === null || saving) return;
    const next = !enabled;
    setSaving(true);
    setError('');
    try {
      await updateUserData(user.uid, { emailNotices: next });
      setEnabled(next);
    } catch {
      setError('Não foi possível salvar agora. Tente de novo em instantes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Avisos por e-mail</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <label className="flex items-start gap-3 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={!!enabled}
            disabled={enabled === null || saving}
            onChange={toggle}
            className="mt-1 h-4 w-4 accent-teal-600"
          />
          <span>
            Receber um e-mail quando a sua nutricionista mandar mensagem no chat, aprovar um plano novo ou responder a um pedido de consulta.
            O e-mail só avisa: o conteúdo fica no aplicativo.
          </span>
        </label>
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      </CardContent>
    </Card>
  );
}
