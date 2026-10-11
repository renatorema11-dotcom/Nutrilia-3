import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  onSnapshot,
  doc,
  setDoc,
  serverTimestamp
} from 'firebase/firestore';
import { db } from './firebase';

export interface DirectMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  senderRole: 'patient' | 'nutritionist';
  text: string;
  createdAt: string;
}

/** Tamanho máximo de uma mensagem; as regras do banco recusam mais do que isso. */
export const MAX_MESSAGE_LENGTH = 4000;

/**
 * Versões antigas guardavam cópias das conversas no navegador. Conversa entre nutricionista e
 * paciente é dado de saúde e não deve ficar no aparelho: esta limpeza apaga o que restou.
 */
const LEGACY_CHAT_PREFIX = 'nutri_direct_messages';
let legacyChatPurged = false;

export function purgeLegacyChatCache(): void {
  if (legacyChatPurged || typeof window === 'undefined') return;
  legacyChatPurged = true;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LEGACY_CHAT_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // ignora — modo privado/navegador sem storage
  }
}

function toMessage(chatId: string, id: string, data: Record<string, any>): DirectMessage {
  return {
    id,
    chatId,
    senderId: data.senderId,
    senderName: data.senderName,
    senderRole: data.senderRole,
    text: data.text,
    createdAt: data.createdAt || new Date().toISOString()
  };
}

/** Envia a mensagem. Se o banco recusar, o erro sobe para a tela avisar que não foi enviada. */
export async function sendDirectMessage(
  chatId: string,
  senderId: string,
  senderName: string,
  senderRole: 'patient' | 'nutritionist',
  text: string
): Promise<DirectMessage> {
  purgeLegacyChatCache();
  const createdAt = new Date().toISOString();
  const message = { senderId, senderName, senderRole, text: text.slice(0, MAX_MESSAGE_LENGTH), createdAt };

  await setDoc(doc(db, 'chats', chatId), { updatedAt: serverTimestamp() }, { merge: true });
  const ref = await addDoc(collection(db, 'chats', chatId, 'messages'), message);

  return { id: ref.id, chatId, ...message };
}

export async function getDirectMessages(chatId: string): Promise<DirectMessage[]> {
  purgeLegacyChatCache();
  const snap = await getDocs(query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt', 'asc')));
  const messages: DirectMessage[] = [];
  snap.forEach((d) => messages.push(toMessage(chatId, d.id, d.data())));
  return messages;
}

export function subscribeToDirectMessages(
  chatId: string,
  callback: (messages: DirectMessage[]) => void,
  onError?: (error: unknown) => void
) {
  purgeLegacyChatCache();
  const q = query(collection(db, 'chats', chatId, 'messages'), orderBy('createdAt', 'asc'));
  return onSnapshot(q, (snap) => {
    const messages: DirectMessage[] = [];
    snap.forEach((d) => messages.push(toMessage(chatId, d.id, d.data())));
    callback(messages);
  }, (err) => {
    console.warn('Não foi possível carregar a conversa:', err);
    callback([]);
    onError?.(err);
  });
}
