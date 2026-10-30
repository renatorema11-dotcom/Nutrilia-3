'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Badge } from '@/components/ui';
import { Calendar as CalendarIcon, Clock, Plus, Trash2, CalendarPlus, Video, CreditCard, Loader2 } from 'lucide-react';
import { format, parseISO, isAfter, startOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useAuth } from './auth-provider';
import { getUserData, updateUserData } from '@/lib/db';
import { ApiError, authFetch, postJson } from '@/lib/api-client';
import { getPatients, type Patient } from '@/lib/patients';
import { AliAppointmentRequests } from './ali-appointment-requests';

export type Appointment = {
  id: string;
  patientName: string;
  date: string; // ISO string
  time: string; // HH:mm
  type: 'Primeira' | 'Retorno';
  status: 'Agendada' | 'Concluída' | 'Cancelada';
  // 'ali': marcada pela Ali, também existe na agenda do Google da nutricionista.
  // 'manual': marcada à mão no app; o servidor grava na lista da nutricionista e na do paciente.
  source?: string;
  meetLink?: string;
  createdBy?: 'patient' | 'nutritionist';
  // Pagamento pelo app (gravado pelo servidor quando o paciente abre e quando o Asaas confirma o pagamento).
  payment?: { status: 'pending' | 'paid' | 'refunded'; value?: number };
};

const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const OTHER_PERSON = '__outra__';
const byStart = (a: Appointment, b: Appointment) =>
  new Date(a.date + 'T' + a.time).getTime() - new Date(b.date + 'T' + b.time).getTime();

export function AppointmentScheduler({ 
  isNutritionist = false, 
  currentPatientName = 'Paciente Atual' 
}: { 
  isNutritionist?: boolean;
  currentPatientName?: string;
}) {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  // Para a nutricionista o nome só é digitado quando a pessoa não tem cadastro no app.
  const [patientName, setPatientName] = useState(isNutritionist ? '' : currentPatientName);
  const [appointmentType, setAppointmentType] = useState<'Primeira' | 'Retorno'>('Retorno');
  const [isFormOpen, setIsFormOpen] = useState(false);
  // Pacientes da nutricionista, para a consulta marcada à mão aparecer também para o paciente escolhido.
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  // Paciente: a nutricionista recebe pelo app? Quanto custa a consulta? E o pagamento que está sendo aberto.
  const [payInfo, setPayInfo] = useState<{ enabled: boolean; price: number | null }>({ enabled: false, price: null });
  const [paying, setPaying] = useState<{ id: string; needCpf: boolean; cpf: string; busy: boolean; error: string } | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    if (!isNutritionist || !user) return;
    getPatients().then(setPatients).catch(() => setPatients([]));
  }, [isNutritionist, user]);

  useEffect(() => {
    if (isNutritionist || !user) return;
    authFetch('/api/payments/consultation', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (data) setPayInfo({ enabled: data.enabled === true, price: typeof data.price === 'number' ? data.price : null }); })
      .catch(() => {});
  }, [isNutritionist, user]);

  /** Abre o pagamento da consulta no Asaas. Na primeira vez o servidor pede o CPF de quem paga. */
  const handlePay = async (id: string, cpf = '') => {
    setPaying({ id, needCpf: !!cpf, cpf, busy: true, error: '' });
    try {
      const res = await authFetch('/api/payments/consultation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appointmentId: id, ...(cpf ? { cpf } : {}) }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && typeof data?.invoiceUrl === 'string') {
        window.location.href = data.invoiceUrl;
        return;
      }
      const error = typeof data?.error === 'string' ? data.error : 'Não foi possível abrir o pagamento agora.';
      setPaying({ id, needCpf: data?.needCpf === true || !!cpf, cpf, busy: false, error: data?.needCpf && !cpf ? '' : error });
    } catch {
      setPaying({ id, needCpf: !!cpf, cpf, busy: false, error: 'Não foi possível abrir o pagamento agora.' });
    }
  };

  useEffect(() => {
    async function loadData() {
      if (user) {
        const data = await getUserData(user.uid);
        if (data?.appointments) {
          setAppointments(data.appointments);
        } else {
          setAppointments([]);
        }
      } else {
        const saved = localStorage.getItem('mockAppointments');
        if (saved) {
          try {
            setAppointments(JSON.parse(saved));
          } catch (e) {
            console.error(e);
          }
        }
      }
    }
    loadData();
  }, [user]);

  const saveAppointments = async (newAppts: Appointment[]) => {
    setAppointments(newAppts);
    if (user) {
      await updateUserData(user.uid, { appointments: newAppts });
    } else {
      localStorage.setItem('mockAppointments', JSON.stringify(newAppts));
    }
  };

  const handleAddAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDate || !newTime || saving) return;
    setFormError('');

    if (!user) {
      // Sem login (modo de demonstração), a consulta fica só neste navegador.
      const local: Appointment = {
        id: Date.now().toString(), patientName: isNutritionist ? patientName : currentPatientName,
        date: newDate, time: newTime, type: appointmentType, status: 'Agendada',
      };
      saveAppointments([...appointments, local].sort(byStart));
    } else {
      const forPatient = isNutritionist && selectedPatientId && selectedPatientId !== OTHER_PERSON;
      if (isNutritionist && !selectedPatientId) { setFormError('Escolha o paciente.'); return; }
      setSaving(true);
      try {
        // O servidor grava na lista da nutricionista e na do paciente: as duas pontas veem a mesma consulta.
        const result = await postJson('/api/appointments/manual', {
          date: newDate, time: newTime, type: appointmentType,
          ...(forPatient ? { patientId: selectedPatientId } : isNutritionist ? { patientName } : {}),
        });
        setAppointments([...appointments, result.appointment as Appointment].sort(byStart));
      } catch (error) {
        setFormError(error instanceof ApiError ? error.message : 'Não foi possível marcar agora. Tente de novo em instantes.');
        return;
      } finally {
        setSaving(false);
      }
    }

    setNewDate('');
    setNewTime('');
    setIsFormOpen(false);
  };

  const handleCancel = async (id: string) => {
    const cancelled = appointments.map(a => a.id === id ? { ...a, status: 'Cancelada' as const } : a);
    const source = appointments.find(a => a.id === id)?.source;
    if (user && (source === 'ali' || source === 'manual')) {
      // O servidor atualiza as duas listas. Se foi a Ali que marcou, também tira da agenda do Google e avisa a outra parte.
      const question = source === 'ali'
        ? 'Cancelar esta consulta? Ela sai da agenda do Google e a outra pessoa é avisada.'
        : 'Cancelar esta consulta? Ela some também da lista da outra pessoa.';
      if (!window.confirm(question)) return;
      try {
        await postJson('/api/appointments/cancel', { id });
      } catch (error) {
        window.alert(error instanceof ApiError ? error.message : 'Não foi possível cancelar agora.');
        return;
      }
      setAppointments(cancelled);
      return;
    }
    saveAppointments(cancelled);
  };

  const handleExportIcs = (appt: Appointment) => {
    const startDate = new Date(`${appt.date}T${appt.time}`);
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour duration
    const now = new Date();

    const formatDate = (date: Date) => {
      return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    };

    const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//NutriApp//PT
BEGIN:VEVENT
UID:${appt.id}@nutriapp.com
DTSTAMP:${formatDate(now)}
DTSTART:${formatDate(startDate)}
DTEND:${formatDate(endDate)}
SUMMARY:Consulta Nutricional - ${appt.type}
DESCRIPTION:Consulta nutricional agendada.
END:VEVENT
END:VCALENDAR`;

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `consulta-${appt.date}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /** Situação do pagamento da consulta: a nutricionista só acompanha; o paciente paga pelo app. */
  const renderPayment = (appt: Appointment) => {
    const status = appt.payment?.status;
    if (status === 'paid') return <div className="w-full"><Badge variant="success" className="text-[10px]">Consulta paga</Badge></div>;
    if (isNutritionist) return status === 'pending' ? <div className="w-full"><Badge variant="warning" className="text-[10px]">Aguardando pagamento</Badge></div> : null;
    // Só as consultas que o servidor conhece (marcadas pelo app ou pela Ali) podem ser pagas.
    if (!payInfo.enabled || payInfo.price === null || (appt.source !== 'manual' && appt.source !== 'ali')) return null;
    const open = paying?.id === appt.id ? paying : null;
    return (
      <div className="w-full space-y-2 border-t border-slate-100 pt-2">
        {!open?.needCpf && (
          <Button onClick={() => handlePay(appt.id)} disabled={!!paying?.busy} className="h-8 text-xs gap-1.5">
            {open?.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CreditCard className="w-3.5 h-3.5" />}
            Pagar consulta · {money(payInfo.price)}
          </Button>
        )}
        {open?.needCpf && (
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              aria-label="CPF de quem vai pagar"
              placeholder="CPF de quem vai pagar"
              value={open.cpf}
              maxLength={14}
              onChange={(e) => setPaying({ ...open, cpf: e.target.value, error: '' })}
              className="flex-1 rounded-lg bg-white border border-slate-300 px-3 py-1.5 text-sm text-slate-900 focus:border-teal-500 outline-none"
            />
            <Button onClick={() => handlePay(appt.id, open.cpf)} disabled={open.busy || !open.cpf} className="h-8 text-xs">
              {open.busy && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />} Continuar para o pagamento
            </Button>
          </div>
        )}
        {open?.needCpf && !open.error && <p className="text-xs text-slate-500">O Asaas pede o CPF de quem paga. Ele vai só para o Asaas.</p>}
        {open?.error && <p role="alert" className="text-xs text-red-700">{open.error}</p>}
      </div>
    );
  };

  // A lista de cada pessoa só tem as consultas dela: não precisa filtrar pelo nome.
  const upcomingAppointments = appointments.filter(a =>
    a.status === 'Agendada' && 
    isAfter(new Date(a.date + 'T' + a.time), new Date())
  );

  return (
    <Card className="w-full h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-slate-100">
        <CardTitle className="flex items-center text-lg">
          <CalendarIcon className="w-5 h-5 mr-2 text-teal-600" />
          Agendamento de Consultas
        </CardTitle>
        <Button 
          variant="outline" 
          onClick={() => setIsFormOpen(!isFormOpen)}
          className="h-8 text-xs flex items-center gap-1"
        >
          {isFormOpen ? 'Fechar' : <><Plus className="w-3 h-3" /> Nova Consulta</>}
        </Button>
      </CardHeader>
      <CardContent className="pt-4">
        <AliAppointmentRequests isNutritionist={isNutritionist} />
        {isFormOpen && (
          <form onSubmit={handleAddAppointment} className="mb-6 p-4 bg-slate-50 rounded-lg border border-slate-100 space-y-4">
            <h4 className="font-medium text-sm text-slate-800">Agendar Novo Horário</h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {isNutritionist && (
                <div className="md:col-span-2 space-y-3">
                  <div className="space-y-1">
                    <label htmlFor="appointmentPatient" className="block text-sm font-medium text-slate-700">Paciente</label>
                    <select
                      id="appointmentPatient"
                      value={selectedPatientId}
                      onChange={(e) => setSelectedPatientId(e.target.value)}
                      required
                      className="w-full rounded-lg bg-white border border-slate-300 px-3 py-2 text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none h-[42px]"
                    >
                      <option value="" disabled>Selecione...</option>
                      {patients.map((patient) => (
                        <option key={patient.id} value={patient.id}>{patient.name}</option>
                      ))}
                      <option value={OTHER_PERSON}>Outra pessoa (sem cadastro no app)</option>
                    </select>
                    {selectedPatientId && selectedPatientId !== OTHER_PERSON && (
                      <p className="text-xs text-slate-500">A consulta também aparece no aplicativo do paciente.</p>
                    )}
                  </div>
                  {selectedPatientId === OTHER_PERSON && (
                    <Input
                      id="patientName"
                      label="Nome da pessoa"
                      value={patientName}
                      onChange={(e) => setPatientName(e.target.value)}
                      required
                    />
                  )}
                </div>
              )}
              
              <div className="space-y-1">
                <label className="block text-sm font-medium text-slate-700">Data</label>
                <input 
                  type="date" 
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  required
                  className="w-full rounded-lg bg-white border border-slate-300 px-3 py-2 text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none"
                />
              </div>
              
              <div className="space-y-1">
                <label className="block text-sm font-medium text-slate-700">Horário</label>
                <input 
                  type="time" 
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                  required
                  className="w-full rounded-lg bg-white border border-slate-300 px-3 py-2 text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none"
                />
              </div>

              {isNutritionist && (
                <div className="md:col-span-2 space-y-1">
                  <label className="block text-sm font-medium text-slate-700">Tipo de Consulta</label>
                  <select
                    value={appointmentType}
                    onChange={(e) => setAppointmentType(e.target.value as any)}
                    className="w-full rounded-lg bg-white border border-slate-300 px-3 py-2 text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none h-[42px]"
                  >
                    <option value="Primeira">Primeira Consulta</option>
                    <option value="Retorno">Retorno</option>
                  </select>
                </div>
              )}
            </div>
            
            {formError && <p role="alert" className="text-sm text-red-600 font-medium">{formError}</p>}

            <Button type="submit" disabled={saving} className="w-full">
              {saving ? 'Marcando...' : 'Confirmar Agendamento'}
            </Button>
          </form>
        )}

        <div className="space-y-4">
          <h4 className="text-sm font-medium text-slate-500 uppercase tracking-wider">
            {isNutritionist ? 'Próximas Consultas' : 'Meus Retornos Agendados'}
          </h4>
          
          {upcomingAppointments.length === 0 ? (
            <div className="text-center py-6 bg-slate-50 rounded-lg border border-slate-100">
              <CalendarIcon className="w-8 h-8 mx-auto text-slate-300 mb-2" />
              <p className="text-sm text-slate-500">Nenhuma consulta agendada.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {upcomingAppointments.map(appt => (
                // sm:flex-wrap: em colunas estreitas (painel da nutricionista) os botões descem para a linha de baixo em vez de ficarem cortados.
                <div key={appt.id} className="flex flex-col sm:flex-row sm:flex-wrap justify-between sm:items-center p-3 border border-slate-200 rounded-lg bg-white shadow-sm hover:border-teal-200 transition-colors gap-3">
                  <div className="flex items-start sm:items-center gap-3">
                    <div className="bg-teal-50 p-2 rounded-md">
                      <CalendarIcon className="w-4 h-4 text-teal-600" />
                    </div>
                    <div>
                      {isNutritionist && <p className="font-medium text-slate-900 text-sm">{appt.patientName}</p>}
                      <div className="flex items-center text-sm text-slate-600">
                        <span>{format(parseISO(appt.date), "dd 'de' MMM, yyyy", { locale: ptBR })}</span>
                        <span className="mx-2">•</span>
                        <Clock className="w-3 h-3 mr-1" />
                        <span>{appt.time}</span>
                      </div>
                      {appt.source === 'manual' && appt.createdBy && appt.createdBy !== (isNutritionist ? 'nutritionist' : 'patient') && (
                        <p className="text-xs text-slate-500">
                          {appt.createdBy === 'patient' ? 'Marcada pelo paciente' : 'Marcada pela nutricionista'}
                        </p>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto sm:ml-auto">
                    <Badge variant={appt.type === 'Retorno' ? 'warning' : 'default'} className="text-[10px]">
                      {appt.type}
                    </Badge>
                    <div className="flex items-center gap-1">
                      {appt.meetLink && (
                        <a
                          href={appt.meetLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-teal-600 hover:text-teal-700 p-1.5 bg-teal-50 hover:bg-teal-100 rounded transition-colors"
                          title="Entrar na chamada"
                        >
                          <Video className="w-4 h-4" />
                        </a>
                      )}
                      <button
                        onClick={() => handleExportIcs(appt)}
                        className="text-teal-600 hover:text-teal-700 p-1.5 bg-teal-50 hover:bg-teal-100 rounded transition-colors"
                        title="Adicionar ao Calendário"
                      >
                        <CalendarPlus className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => handleCancel(appt.id)}
                        className="text-red-500 hover:text-red-700 p-1.5 bg-red-50 hover:bg-red-100 rounded transition-colors"
                        title="Cancelar consulta"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {renderPayment(appt)}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
