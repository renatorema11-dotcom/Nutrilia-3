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

const LOCAL_STORAGE_CHAT_KEY = 'nutri_direct_messages';

function getLocalMessages(chatId: string): DirectMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(`${LOCAL_STORAGE_CHAT_KEY}_${chatId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalMessage(chatId: string, msg: DirectMessage) {
  if (typeof window === 'undefined') return;
  try {
    const existing = getLocalMessages(chatId);
    const updated = [...existing, msg];
    localStorage.setItem(`${LOCAL_STORAGE_CHAT_KEY}_${chatId}`, JSON.stringify(updated));
  } catch (e) {
    console.warn('Failed to save local message:', e);
  }
}

export async function sendDirectMessage(
  chatId: string,
  senderId: string,
  senderName: string,
  senderRole: 'patient' | 'nutritionist',
  text: string
): Promise<DirectMessage> {
  const newMsg: DirectMessage = {
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    chatId,
    senderId,
    senderName,
    senderRole,
    text,
    createdAt: new Date().toISOString()
  };

  saveLocalMessage(chatId, newMsg);

  try {
    const chatRef = doc(db, 'chats', chatId);
    await setDoc(chatRef, { updatedAt: serverTimestamp() }, { merge: true });

    const messagesCol = collection(db, 'chats', chatId, 'messages');
    await addDoc(messagesCol, {
      senderId,
      senderName,
      senderRole,
      text,
      createdAt: new Date().toISOString()
    });
  } catch (err) {
    console.warn('Firestore message send warning (saved to local fallback):', err);
  }

  return newMsg;
}

export async function getDirectMessages(chatId: string): Promise<DirectMessage[]> {
  const localMsgs = getLocalMessages(chatId);

  try {
    const messagesCol = collection(db, 'chats', chatId, 'messages');
    const q = query(messagesCol, orderBy('createdAt', 'asc'));
    const snap = await getDocs(q);

    const remoteMsgs: DirectMessage[] = [];
    snap.forEach((d) => {
      const data = d.data();
      remoteMsgs.push({
        id: d.id,
        chatId,
        senderId: data.senderId,
        senderName: data.senderName,
        senderRole: data.senderRole,
        text: data.text,
        createdAt: data.createdAt || new Date().toISOString()
      });
    });

    if (remoteMsgs.length > 0) {
      return remoteMsgs;
    }
  } catch (e) {
    console.warn('Firestore load messages warning:', e);
  }

  return localMsgs;
}

export function subscribeToDirectMessages(
  chatId: string,
  callback: (messages: DirectMessage[]) => void
) {
  try {
    const messagesCol = collection(db, 'chats', chatId, 'messages');
    const q = query(messagesCol, orderBy('createdAt', 'asc'));

    const unsubscribe = onSnapshot(q, (snap) => {
      const remoteMsgs: DirectMessage[] = [];
      snap.forEach((d) => {
        const data = d.data();
        remoteMsgs.push({
          id: d.id,
          chatId,
          senderId: data.senderId,
          senderName: data.senderName,
          senderRole: data.senderRole,
          text: data.text,
          createdAt: data.createdAt || new Date().toISOString()
        });
      });

      if (remoteMsgs.length > 0) {
        callback(remoteMsgs);
      } else {
        callback(getLocalMessages(chatId));
      }
    }, (err) => {
      console.warn('Snapshot listener error, returning local messages:', err);
      callback(getLocalMessages(chatId));
    });

    return unsubscribe;
  } catch (e) {
    console.warn('Subscribe error:', e);
    callback(getLocalMessages(chatId));
    return () => {};
  }
}
