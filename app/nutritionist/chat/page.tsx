'use client';

import { useState, useRef, useEffect, Suspense } from 'react';
import { Card, CardContent, Input, Button, Badge } from '@/components/ui';
import { Send, User, Stethoscope, Search, Loader2, ArrowRight, ChevronRight, MessageSquare, ExternalLink } from 'lucide-react';
import { useAuth } from '@/components/auth-provider';
import { getPatients, Patient } from '@/lib/patients';
import {
  DirectMessage,
  sendDirectMessage,
  subscribeToDirectMessages
} from '@/lib/chat';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';

function NutritionistChatContent() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialPatientId = searchParams.get('patientId');

  const [patients, setPatients] = useState<Patient[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [search, setSearch] = useState('');

  // Messages State
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load all patients
  useEffect(() => {
    async function loadData() {
      setLoadingPatients(true);
      try {
        const list = await getPatients();
        setPatients(list);

        if (initialPatientId) {
          const match = list.find((p) => p.id === initialPatientId);
          if (match) {
            setSelectedPatient(match);
          } else if (list.length > 0) {
            setSelectedPatient(list[0]);
          }
        } else if (list.length > 0) {
          setSelectedPatient(list[0]);
        }
      } catch (err) {
        console.error('Erro ao carregar lista de pacientes para chat:', err);
      } finally {
        setLoadingPatients(false);
      }
    }

    loadData();
  }, [initialPatientId]);

  // Subscribe to real-time chat with the selected patient
  useEffect(() => {
    if (!selectedPatient?.id || !user?.uid) return;

    const chatId = `${selectedPatient.id}_${user.uid}`;
    const unsubscribe = subscribeToDirectMessages(chatId, (msgs) => {
      setMessages(msgs);
    });

    return () => {
      unsubscribe();
    };
  }, [selectedPatient?.id, user?.uid]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, selectedPatient]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !user?.uid || !selectedPatient?.id) return;

    const text = inputText.trim();
    setInputText('');
    setSending(true);

    const chatId = `${selectedPatient.id}_${user.uid}`;
    const senderName = user.displayName || 'Nutricionista';

    try {
      await sendDirectMessage(chatId, user.uid, senderName, 'nutritionist', text);
    } catch (err) {
      console.error('Erro ao enviar mensagem:', err);
    } finally {
      setSending(false);
    }
  };

  const filteredPatients = patients.filter(
    (p) =>
      (p.name || '').toLowerCase().includes((search || '').toLowerCase()) ||
      (p.email || '').toLowerCase().includes((search || '').toLowerCase())
  );

  if (loadingPatients) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
        <p className="text-sm font-medium text-slate-600">Carregando centro de mensagens...</p>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-7.5rem)] flex flex-col space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Chat com Pacientes</h1>
          <p className="text-xs text-slate-600">
            Responda e acompanhe as dúvidas dos seus pacientes em tempo real.
          </p>
        </div>
      </div>

      {/* Main Layout Grid */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-4 min-h-0">
        {/* Left Column: Patient List */}
        <Card className="flex flex-col min-h-0 border-slate-200/80 shadow-md">
          <div className="p-3.5 border-b border-slate-100 bg-slate-50/50 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5 text-teal-600" /> Pacientes ({patients.length})
              </span>
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar paciente..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-500 text-slate-800"
              />
            </div>
          </div>

          <CardContent className="flex-1 overflow-y-auto p-2 space-y-1">
            {filteredPatients.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                Nenhum paciente encontrado.
              </div>
            ) : (
              filteredPatients.map((patient) => {
                const isSelected = selectedPatient?.id === patient.id;
                return (
                  <button
                    key={patient.id}
                    onClick={() => {
                      setSelectedPatient(patient);
                      router.replace(`/nutritionist/chat?patientId=${patient.id}`);
                    }}
                    className={`w-full text-left p-3 rounded-xl transition-all flex items-center justify-between gap-2 ${
                      isSelected
                        ? 'bg-teal-700 text-white shadow-sm'
                        : 'hover:bg-slate-100/80 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                          isSelected
                            ? 'bg-white/20 text-white'
                            : 'bg-teal-100 text-teal-800'
                        }`}
                      >
                        {patient.name?.charAt(0).toUpperCase() || 'P'}
                      </div>
                      <div className="min-w-0">
                        <p className={`font-semibold text-xs truncate ${isSelected ? 'text-white' : 'text-slate-800'}`}>
                          {patient.name}
                        </p>
                        <p className={`text-[11px] truncate ${isSelected ? 'text-teal-100' : 'text-slate-500'}`}>
                          {patient.objective || 'Atendimento'}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className={`w-4 h-4 shrink-0 ${isSelected ? 'text-white' : 'text-slate-300'}`} />
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Right Column: Active Conversation */}
        <Card className="md:col-span-2 flex flex-col min-h-0 border-slate-200/80 shadow-md">
          {selectedPatient ? (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Chat Header */}
              <div className="p-3.5 bg-gradient-to-r from-teal-800 to-emerald-800 text-white flex items-center justify-between px-5 border-b shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-white/20 border border-white/40 flex items-center justify-center font-bold text-white text-sm">
                    {selectedPatient.name?.charAt(0).toUpperCase() || 'P'}
                  </div>
                  <div>
                    <h3 className="font-bold text-sm leading-tight">{selectedPatient.name}</h3>
                    <p className="text-[11px] text-teal-100">
                      {selectedPatient.age ? `${selectedPatient.age} anos` : ''} {selectedPatient.weight ? `• ${selectedPatient.weight} kg` : ''} • {selectedPatient.objective}
                    </p>
                  </div>
                </div>

                <Link
                  href={`/nutritionist/patients/${selectedPatient.id}`}
                  className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg text-white font-medium transition-colors flex items-center gap-1.5"
                >
                  Prontuário <ExternalLink className="w-3 h-3" />
                </Link>
              </div>

              {/* Messages Feed */}
              <CardContent className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50">
                {messages.length === 0 ? (
                  <div className="py-16 text-center text-slate-500 space-y-2">
                    <MessageSquare className="w-10 h-10 text-teal-600/40 mx-auto" />
                    <p className="font-semibold text-sm text-slate-700">
                      Nenhuma mensagem trocada com {selectedPatient.name} ainda.
                    </p>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">
                      Envie uma mensagem abaixo para iniciar a conversa diretamente com este paciente.
                    </p>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isNutri = msg.senderRole === 'nutritionist';
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isNutri ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`flex max-w-[80%] ${
                            isNutri ? 'flex-row-reverse' : 'flex-row'
                          }`}
                        >
                          <div
                            className={`flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
                              isNutri
                                ? 'bg-teal-700 text-white ml-2.5'
                                : 'bg-slate-200 text-slate-700 mr-2.5'
                            }`}
                          >
                            {isNutri ? (
                              <Stethoscope className="h-4 w-4 text-white" />
                            ) : (
                              <User className="h-4 w-4 text-slate-600" />
                            )}
                          </div>

                          <div
                            className={`p-3.5 rounded-2xl text-sm ${
                              isNutri
                                ? 'bg-teal-700 text-white rounded-tr-none shadow-sm'
                                : 'bg-white text-slate-800 border border-slate-200/80 rounded-tl-none shadow-sm'
                            }`}
                          >
                            <p className="text-[10px] font-bold opacity-75 mb-0.5">
                              {msg.senderName}
                            </p>
                            <p className="whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                            <p
                              className={`text-[9px] mt-1 text-right ${
                                isNutri ? 'text-teal-200' : 'text-slate-400'
                              }`}
                            >
                              {new Date(msg.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </CardContent>

              {/* Message Input */}
              <div className="p-3.5 bg-white border-t border-slate-100">
                <form onSubmit={handleSend} className="flex gap-2">
                  <Input
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder={`Responder para ${selectedPatient.name}...`}
                    className="flex-1 bg-slate-50 border-slate-200 text-sm rounded-xl"
                  />
                  <Button
                    type="submit"
                    disabled={sending || !inputText.trim()}
                    className="bg-teal-700 hover:bg-teal-800 text-white rounded-xl px-5"
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </form>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
              <MessageSquare className="w-12 h-12 text-slate-300" />
              <h3 className="text-base font-bold text-slate-800">Selecione um Paciente</h3>
              <p className="text-xs text-slate-500 max-w-sm">
                Escolha um paciente na lista à esquerda para carregar o histórico de conversas e responder mensagens.
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function NutritionistChatPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
      </div>
    }>
      <NutritionistChatContent />
    </Suspense>
  );
}
