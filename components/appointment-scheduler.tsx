'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Badge } from '@/components/ui';
import { Calendar as CalendarIcon, Clock, Plus, Trash2, CalendarPlus } from 'lucide-react';
import { format, parseISO, isAfter, startOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export type Appointment = {
  id: string;
  patientName: string;
  date: string; // ISO string
  time: string; // HH:mm
  type: 'Primeira' | 'Retorno';
  status: 'Agendada' | 'Concluída' | 'Cancelada';
};

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
  const [patientName, setPatientName] = useState(currentPatientName);
  const [appointmentType, setAppointmentType] = useState<'Primeira' | 'Retorno'>('Retorno');
  const [isFormOpen, setIsFormOpen] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('mockAppointments');
    if (saved) {
      try {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAppointments(JSON.parse(saved));
      } catch (e) {
        console.error(e);
      }
    } else {
      // Mock initial data
      const initial: Appointment[] = [
        {
          id: '1',
          patientName: 'Maria Souza',
          date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
          time: '14:00',
          type: 'Retorno',
          status: 'Agendada'
        },
        {
          id: '2',
          patientName: 'Carlos Oliveira',
          date: new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0],
          time: '09:00',
          type: 'Primeira',
          status: 'Agendada'
        }
      ];
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAppointments(initial);
      localStorage.setItem('mockAppointments', JSON.stringify(initial));
    }
  }, []);

  const saveAppointments = (newAppts: Appointment[]) => {
    setAppointments(newAppts);
    localStorage.setItem('mockAppointments', JSON.stringify(newAppts));
  };

  const handleAddAppointment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDate || !newTime) return;

    const newAppt: Appointment = {
      id: Date.now().toString(),
      patientName: isNutritionist ? patientName : currentPatientName,
      date: newDate,
      time: newTime,
      type: appointmentType,
      status: 'Agendada'
    };

    saveAppointments([...appointments, newAppt].sort((a, b) => {
      return new Date(a.date + 'T' + a.time).getTime() - new Date(b.date + 'T' + b.time).getTime();
    }));
    
    setNewDate('');
    setNewTime('');
    setIsFormOpen(false);
  };

  const handleCancel = (id: string) => {
    saveAppointments(appointments.map(a => a.id === id ? { ...a, status: 'Cancelada' } : a));
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

  // Filter based on role
  const displayAppointments = isNutritionist 
    ? appointments 
    : appointments.filter(a => a.patientName === currentPatientName);

  const upcomingAppointments = displayAppointments.filter(a => 
    a.status === 'Agendada' && 
    isAfter(new Date(a.date + 'T' + a.time), new Date())
  );

  return (
    <Card className="w-full">
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
        {isFormOpen && (
          <form onSubmit={handleAddAppointment} className="mb-6 p-4 bg-slate-50 rounded-lg border border-slate-100 space-y-4">
            <h4 className="font-medium text-sm text-slate-800">Agendar Novo Horário</h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {isNutritionist && (
                <div className="md:col-span-2">
                  <Input 
                    id="patientName"
                    label="Nome do Paciente"
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    required
                  />
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
            
            <Button type="submit" className="w-full">
              Confirmar Agendamento
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
                <div key={appt.id} className="flex flex-col sm:flex-row justify-between sm:items-center p-3 border border-slate-200 rounded-lg bg-white shadow-sm hover:border-teal-200 transition-colors gap-3">
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
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                    <Badge variant={appt.type === 'Retorno' ? 'warning' : 'default'} className="text-[10px]">
                      {appt.type}
                    </Badge>
                    <div className="flex items-center gap-1">
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
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
