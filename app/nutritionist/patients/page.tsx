'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, Button, Badge } from '@/components/ui';
import { Search, ChevronRight, UserPlus, Users, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { getPatients, Patient } from '@/lib/patients';
import { AddPatientModal } from '@/components/add-patient-modal';

export default function PatientsList() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
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

  const filteredPatients = patients.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pacientes</h1>
          <p className="text-gray-600">Gerencie todos os seus pacientes em tempo real.</p>
        </div>
        <Button
          onClick={() => setIsModalOpen(true)}
          className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium flex items-center gap-2 shadow-sm"
        >
          <UserPlus className="w-4 h-4" />
          + Novo Paciente
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b border-gray-100 flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar paciente por nome ou email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-gray-300 pl-10 pr-4 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
            </div>
          </div>

          {loading ? (
            <div className="p-12 text-center text-gray-500 flex flex-col items-center justify-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
              <p className="text-sm font-medium">Carregando lista de pacientes...</p>
            </div>
          ) : patients.length === 0 ? (
            <div className="p-12 text-center text-gray-500 flex flex-col items-center justify-center gap-3">
              <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 mb-2">
                <Users className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-gray-900">Nenhum paciente cadastrado</h3>
              <p className="text-sm text-gray-500 max-w-md">
                Você ainda não possui pacientes cadastrados no sistema. Clique abaixo para cadastrar o seu primeiro paciente!
              </p>
              <Button
                onClick={() => setIsModalOpen(true)}
                className="mt-2 bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2"
              >
                <UserPlus className="w-4 h-4" />
                Cadastrar Primeiro Paciente
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredPatients.map((patient) => (
                <Link
                  key={patient.id}
                  href={`/nutritionist/patients/${patient.id}`}
                  className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
                >
                  <div>
                    <p className="font-medium text-gray-900">{patient.name}</p>
                    <p className="text-sm text-gray-500">
                      {patient.email} • {patient.age} anos • {patient.objective}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    {patient.currentPlan ? (
                      patient.currentPlan.status === 'approved' ? (
                        <Badge variant="success">Plano Ativo</Badge>
                      ) : (
                        <Badge variant="warning">Aprovação Pendente</Badge>
                      )
                    ) : (
                      <Badge variant="default">Sem Plano</Badge>
                    )}
                    <ChevronRight className="w-5 h-5 text-gray-400" />
                  </div>
                </Link>
              ))}

              {filteredPatients.length === 0 && patients.length > 0 && (
                <div className="p-8 text-center text-gray-500">
                  Nenhum paciente encontrado para a busca &quot;{search}&quot;.
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Modal para adicionar paciente */}
      <AddPatientModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onPatientAdded={handlePatientAdded}
      />
    </div>
  );
}
