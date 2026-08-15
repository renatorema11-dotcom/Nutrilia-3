'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from '@/components/ui';
import { Bell, ChevronRight, UserPlus, Users, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { AppointmentScheduler } from '@/components/appointment-scheduler';
import { PatientGoalsChart } from '@/components/patient-goals-chart';
import { getPatients, Patient } from '@/lib/patients';
import { AddPatientModal } from '@/components/add-patient-modal';
import { useAuth } from '@/components/auth-provider';

export default function NutritionistDashboard() {
  const { user } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const data = await getPatients();
        setPatients(data);
      } catch (err) {
        console.error('Erro ao carregar pacientes:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handlePatientAdded = (newPatient: Patient) => {
    setPatients((prev) => [newPatient, ...prev]);
  };

  const nutritionistName = user?.displayName || 'Nutricionista';
  const recentPatients = patients.slice(0, 5);

  // Generate real dynamic alerts based on patient states
  const alerts = patients.filter(p => !p.currentPlan || p.currentPlan.status === 'draft').map(p => ({
    id: p.id,
    type: 'action',
    message: !p.currentPlan
      ? `Paciente ${p.name} cadastrado(a) e aguarda criação de plano alimentar.`
      : `Rascunho de plano para ${p.name} aguarda sua revisão e aprovação.`
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Olá, {nutritionistName}</h1>
          <p className="text-gray-600">Resumo em tempo real do seu consultório.</p>
        </div>
        <Button
          onClick={() => setIsModalOpen(true)}
          className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium flex items-center gap-2 shadow-sm"
        >
          <UserPlus className="w-4 h-4" />
          + Novo Paciente
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center text-slate-800">
              <Bell className="w-5 h-5 mr-2 text-amber-500" />
              Notificações do Consultório ({alerts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {alerts.length > 0 ? (
              <div className="space-y-3">
                {alerts.map((alert) => (
                  <div key={alert.id} className="flex items-center justify-between p-3 bg-amber-50 rounded-lg border border-amber-100">
                    <p className="text-amber-900 text-sm font-medium">{alert.message}</p>
                    <Link href={`/nutritionist/patients/${alert.id}`}>
                      <Button variant="ghost" className="text-amber-800 hover:bg-amber-100 text-xs h-7 px-2">
                        Atender
                      </Button>
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center text-slate-500 text-sm border border-dashed rounded-lg bg-slate-50">
                Nenhum alerta pendente no momento. Seus pacientes estão em dia!
              </div>
            )}
            <div className="mt-6">
              <Link href="/nutritionist/assistant">
                <Button variant="outline" className="w-full">Abrir Assistente com IA</Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <AppointmentScheduler isNutritionist={true} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Pacientes Recentes</CardTitle>
              <Link href="/nutritionist/patients" className="text-sm font-medium text-emerald-600 hover:text-emerald-500 flex items-center">
                Ver todos ({patients.length}) <ChevronRight className="w-4 h-4 ml-1" />
              </Link>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="p-8 text-center text-gray-500 flex justify-center items-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
                  Carregando pacientes...
                </div>
              ) : recentPatients.length === 0 ? (
                <div className="p-8 text-center text-gray-500 flex flex-col items-center justify-center gap-2">
                  <Users className="w-10 h-10 text-gray-300" />
                  <p className="text-sm font-medium text-gray-700">Nenhum paciente cadastrado</p>
                  <Button
                    onClick={() => setIsModalOpen(true)}
                    variant="outline"
                    className="mt-2 text-emerald-600 border-emerald-200 hover:bg-emerald-50 text-xs"
                  >
                    + Cadastrar Primeiro Paciente
                  </Button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-gray-500 uppercase bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 font-medium rounded-tl-lg">Nome</th>
                        <th className="px-4 py-3 font-medium">Objetivo</th>
                        <th className="px-4 py-3 font-medium">Status do Plano</th>
                        <th className="px-4 py-3 font-medium rounded-tr-lg text-right">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentPatients.map((patient) => (
                        <tr key={patient.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/50">
                          <td className="px-4 py-4 font-medium text-gray-900">{patient.name}</td>
                          <td className="px-4 py-4 text-gray-600">{patient.objective}</td>
                          <td className="px-4 py-4">
                            {patient.currentPlan ? (
                              patient.currentPlan.status === 'approved' ? (
                                <Badge variant="success">Ativo</Badge>
                              ) : (
                                <Badge variant="warning">Rascunho (IA)</Badge>
                              )
                            ) : (
                              <Badge variant="default">Sem plano</Badge>
                            )}
                          </td>
                          <td className="px-4 py-4 text-right">
                            <Link href={`/nutritionist/patients/${patient.id}`}>
                              <Button variant="ghost" className="text-emerald-600 hover:bg-emerald-50 text-sm h-8 px-3">
                                Abrir Prontuário
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        <div>
          <PatientGoalsChart />
        </div>
      </div>

      <AddPatientModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onPatientAdded={handlePatientAdded}
      />
    </div>
  );
}
