'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { auth, onAuthStateChanged } from '@/lib/firebase';
import { ApiError, aliSessionAuth, postJson } from '@/lib/api-client';
import { photoDataUrl } from '@/lib/photo';
import { MEAL_PHOTO_ASK, MEAL_PHOTO_FAILED_MESSAGE, MEAL_PHOTO_WAIT, type MealPhotoAnalysis } from '@/lib/meal-photo';
import { useConversation, ConversationProvider } from '@elevenlabs/react';
import { Button } from '@/components/ui';
import { Mic, MicOff, Loader2, Bot, Camera } from 'lucide-react';

type PhotoState =
  | { step: 'idle' }
  | { step: 'analyzing' }
  | { step: 'done'; analysis: MealPhotoAnalysis; delivered: boolean }
  | { step: 'error'; text: string };

// Análise feita com a conversa fechada (ou que caiu enquanto a câmera estava aberta) ainda vale por este tempo.
const PENDING_PHOTO_MS = 10 * 60 * 1000;
// Ao abrir a conversa, espera a Ali cumprimentar antes de entregar a foto que estava aguardando.
const GREETING_PAUSE_MS = 2500;

// Valores usados se a personalização da nutricionista não carregar: a Ali precisa receber todas as variáveis.
const DEFAULT_ALI_CONTEXT: Record<string, string> = {
  patientFirstName: 'tudo bem',
  nutritionistName: 'sua nutricionista',
  attendanceInfo: 'Horários de atendimento não informados.',
  clinicInfo: 'Nenhuma informação do consultório cadastrada.',
  nutritionistGuidelines: 'Nenhuma orientação adicional.',
  agendaStatus: 'nao_conectada',
};

/** Personalização da Ali definida pela nutricionista do paciente (horários, consultório, orientações). */
async function loadAliContext(token: string): Promise<Record<string, string>> {
  try {
    const res = await fetch('/api/ali/context', { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (!res.ok) return DEFAULT_ALI_CONTEXT;
    const data = await res.json();
    const vars = data?.dynamicVariables;
    if (!vars || typeof vars !== 'object') return DEFAULT_ALI_CONTEXT;
    return Object.fromEntries(Object.keys(DEFAULT_ALI_CONTEXT).map((key) => [
      key, typeof vars[key] === 'string' && vars[key] ? vars[key] : DEFAULT_ALI_CONTEXT[key],
    ]));
  } catch {
    return DEFAULT_ALI_CONTEXT;
  }
}

function AgentInner({
  agentId,
  dynamicVariables,
}: {
  agentId: string;
  dynamicVariables?: Record<string, string>;
}) {
  const { startSession, endSession, status, isSpeaking, sendContextualUpdate, sendUserMessage } = useConversation();

  const [sessionError, setSessionError] = useState('');
  const [starting, setStarting] = useState(false);
  const [photo, setPhoto] = useState<PhotoState>({ step: 'idle' });
  const sessionUid = useRef<string | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingPhoto = useRef<{ context: string; at: number } | null>(null);
  const statusRef = useRef(status);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, current => {
      if (sessionUid.current && current?.uid !== sessionUid.current) {
        void endSession();
        sessionUid.current = null;
      }
      if (!current) {
        pendingPhoto.current = null;
        setPhoto({ step: 'idle' });
      }
    });
    return () => { unsubscribe(); if (expiryTimer.current) clearTimeout(expiryTimer.current); };
  }, [endSession]);

  // A análise entra na conversa como contexto, e uma fala curta do paciente pede o comentário: a Ali responde na hora.
  // Devolve false se a conversa não estiver aberta (ou tiver acabado de cair).
  const deliverPhoto = useCallback((context: string): boolean => {
    if (statusRef.current !== 'connected') return false;
    try {
      sendContextualUpdate(context);
      sendUserMessage(MEAL_PHOTO_ASK);
      return true;
    } catch {
      return false;
    }
  }, [sendContextualUpdate, sendUserMessage]);

  useEffect(() => {
    statusRef.current = status;
    if (status !== 'connected' || !pendingPhoto.current) return;
    // Foto analisada antes de a conversa abrir: a Ali comenta logo depois de cumprimentar.
    const timer = setTimeout(() => {
      const pending = pendingPhoto.current;
      if (!pending) return;
      if (Date.now() - pending.at > PENDING_PHOTO_MS) pendingPhoto.current = null;
      else if (deliverPhoto(pending.context)) {
        pendingPhoto.current = null;
        setPhoto((current) => (current.step === 'done' ? { ...current, delivered: true } : current));
      }
    }, GREETING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [status, deliverPhoto]);

  const handlePhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Limpa o campo para a mesma foto poder ser escolhida de novo.
    event.target.value = '';
    if (!file) return;
    setPhoto({ step: 'analyzing' });
    pendingPhoto.current = null;
    if (statusRef.current === 'connected') {
      // Só um aviso para a Ali esperar; se a conversa tiver caído, a análise segue do mesmo jeito.
      try { sendContextualUpdate(MEAL_PHOTO_WAIT); } catch { /* conversa fechada */ }
    }
    try {
      const data = await postJson('/api/ali/meal-photo', { image: await photoDataUrl(file) });
      if (typeof data?.message !== 'string' || !data.analysis) throw new ApiError('Não foi possível analisar a foto agora.');
      const delivered = deliverPhoto(data.message);
      // Abrir a câmera pode derrubar a conversa no celular: a análise fica guardada e segue quando ela reabrir.
      if (!delivered) pendingPhoto.current = { context: data.message, at: Date.now() };
      setPhoto({ step: 'done', analysis: data.analysis as MealPhotoAnalysis, delivered });
    } catch (error) {
      setPhoto({ step: 'error', text: error instanceof ApiError ? error.message : 'Não foi possível analisar a foto agora.' });
      // Com a conversa aberta, a Ali também avisa que não conseguiu ver a foto, sem inventar o que tinha no prato.
      deliverPhoto(MEAL_PHOTO_FAILED_MESSAGE);
    }
  };

  const handleToggleSession = async () => {
    if (status === 'connected') {
      await endSession();
      sessionUid.current = null;
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
    } else {
      setSessionError('');
      setStarting(true);
      try {
        const current = auth.currentUser;
        if (!current || current.isAnonymous) throw new Error('Entre com sua conta de paciente para conversar com a Ali.');
        const token = await current.getIdToken(true);
        if (auth.currentUser?.uid !== current.uid) throw new Error('Sua sessão mudou. Entre novamente.');
        const aliContext = await loadAliContext(token);
        // O servidor emite a credencial da conversa para quem está logado; sem ela, vale o identificador do agente.
        const sessionAuth = await aliSessionAuth(token, 'voice');
        sessionUid.current = current.uid;
        const variables = { ...aliContext, ...dynamicVariables, patientUid: current.uid, secret__patientToken: token };
        await startSession(sessionAuth && 'conversationToken' in sessionAuth
          ? { conversationToken: sessionAuth.conversationToken, dynamicVariables: variables }
          : { agentId, dynamicVariables: variables });
        if (auth.currentUser?.uid !== current.uid) {
          await endSession();
          throw new Error('Sessão alterada durante a conexão.');
        }
        // O ID token expira em uma hora. Encerrar antes disso exige nova autenticação.
        if (expiryTimer.current) clearTimeout(expiryTimer.current);
        expiryTimer.current = setTimeout(() => {
          void endSession();
          sessionUid.current = null;
          setSessionError('Inicie uma nova conversa para renovar sua sessão.');
        }, 50 * 60 * 1000);
      } catch {
        sessionUid.current = null;
        setSessionError('Não foi possível iniciar a Ali. Entre com sua conta de paciente e tente novamente.');
      } finally { setStarting(false); }
    }
  };

  return (
    // No celular fica compacto (texto à esquerda, botão à direita); no computador, em coluna.
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 p-4 bg-teal-50 rounded-xl border border-teal-100 lg:flex lg:flex-col lg:items-center lg:gap-4">
      <div className="text-left lg:text-center space-y-1 lg:space-y-2">
        <h3 className="font-semibold text-teal-900 flex items-center lg:justify-center gap-2">
          <Bot className="w-5 h-5 text-teal-600" />
          <span translate="no">Ali</span> — Assistente de Voz
        </h3>
        <p className="text-sm text-slate-600">
          Converse com a Ali: registre seu peso, anote refeições e peça consultas
        </p>
      </div>

      <div className="relative row-span-2">
        <div className={`absolute inset-0 bg-teal-500 rounded-full blur-xl opacity-20 transition-all duration-500 ${isSpeaking ? 'scale-150 opacity-40' : 'scale-100 opacity-20'}`} />
        <Button
          onClick={handleToggleSession}
          disabled={starting || status === 'connecting'}
          className={`relative h-16 w-16 rounded-full flex items-center justify-center transition-all ${
            status === 'connected' 
              ? 'bg-red-500 hover:bg-red-600 shadow-red-500/30' 
              : 'bg-teal-600 hover:bg-teal-700 shadow-teal-600/30'
          }`}
        >
          {status === 'connecting' ? (
            <Loader2 className="w-6 h-6 text-white animate-spin" />
          ) : status === 'connected' ? (
            <MicOff className="w-6 h-6 text-white" />
          ) : (
            <Mic className="w-6 h-6 text-white" />
          )}
        </Button>
      </div>
      
      <div className="justify-self-start text-xs font-medium px-3 py-1 bg-white rounded-full border border-teal-200 text-teal-800">
        Status: {status === 'connected' ? 'Conectado' : status === 'connecting' ? 'Conectando...' : 'Desconectado'}
      </div>

      {sessionError && <p role="alert" className="col-span-2 text-sm text-red-700">{sessionError}</p>}
      {status === 'connected' && (
        <div className="col-span-2 text-xs text-slate-500 animate-pulse">
          {isSpeaking ? 'O Ali está falando...' : 'Ouvindo...'}
        </div>
      )}

      {/* Foto do prato: a IA descreve e estima as calorias; a Ali comenta por voz. */}
      <div className="col-span-2 w-full space-y-2">
        <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={handlePhoto} />
        <Button
          variant="outline"
          onClick={() => fileInput.current?.click()}
          disabled={photo.step === 'analyzing'}
          className="w-full bg-white text-sm gap-2"
        >
          {photo.step === 'analyzing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4 text-teal-700" />}
          {photo.step === 'analyzing' ? 'Analisando a foto...' : 'Enviar foto do prato'}
        </Button>
        {photo.step === 'error' && <p role="alert" className="text-sm text-red-700">{photo.text}</p>}
        {photo.step === 'done' && (
          <div role="status" className="rounded-lg bg-white border border-teal-100 p-3 text-left text-sm space-y-1">
            {photo.analysis.isFood ? (
              <>
                <p className="font-medium text-slate-800">{photo.analysis.dish}</p>
                {photo.analysis.taco && photo.analysis.taco.counted === photo.analysis.taco.items ? (
                  <p className="text-slate-700">
                    Cerca de {photo.analysis.taco.kcal} kcal
                    <span className="block text-xs text-slate-500">Pela tabela TACO, com as porções estimadas pela foto.</span>
                  </p>
                ) : photo.analysis.kcalMin !== null && photo.analysis.kcalMax !== null ? (
                  <p className="text-slate-700">
                    Cerca de {photo.analysis.kcalMin} a {photo.analysis.kcalMax} kcal
                    <span className="block text-xs text-slate-500">Estimativa pela foto, não é um valor exato.</span>
                  </p>
                ) : (
                  <p className="text-slate-600">Não deu para estimar as calorias por esta foto.</p>
                )}
              </>
            ) : (
              <p className="text-slate-700">A foto não parece mostrar uma refeição.</p>
            )}
            {!photo.delivered && <p className="text-xs font-medium text-teal-800">Toque no microfone para a Ali comentar.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

export function ElevenLabsAgent({
  agentId,
  dynamicVariables,
}: {
  agentId?: string;
  dynamicVariables?: Record<string, string>;
}) {
  // Se não houver agentId, mostramos um aviso para configuração
  if (!agentId) {
    return (
      <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-center space-y-3">
        <Bot className="w-8 h-8 text-slate-400 mx-auto" />
        <h3 className="font-semibold text-slate-700">Agente ElevenLabs não configurado</h3>
        <p className="text-sm text-slate-500">
          Para ativar o assistente de voz, configure a variável <code className="bg-slate-200 px-1 py-0.5 rounded">NEXT_PUBLIC_ELEVENLABS_AGENT_ID</code> no ambiente.
        </p>
      </div>
    );
  }

  return (
    <ConversationProvider>
      <AgentInner agentId={agentId} dynamicVariables={dynamicVariables} />
    </ConversationProvider>
  );
}
