'use client';

import { useState } from 'react';
import { MOCK_PATIENTS_LIST } from '@/lib/mock-data';
import { Card, CardContent, Input, Button, Badge } from '@/components/ui';
import { Search, ChevronRight } from 'lucide-react';
import Link from 'next/link';

export default function PatientsList() {
  const [search, setSearch] = useState('');

  const filteredPatients = MOCK_PATIENTS_LIST.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pacientes</h1>
          <p className="text-gray-600">Gerencie todos os seus pacientes.</p>
        </div>
        <Button>+ Novo Paciente</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b border-gray-100 flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <div className="space-y-0">
                <input
                  type="text"
                  placeholder="Buscar paciente por nome ou email..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 pl-10 pr-4 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>
          </div>
          
          <div className="divide-y divide-gray-100">
            {filteredPatients.map(patient => (
              <Link 
                key={patient.id} 
                href={`/nutritionist/patients/${patient.id}`}
                className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors"
              >
                <div>
                  <p className="font-medium text-gray-900">{patient.name}</p>
                  <p className="text-sm text-gray-500">{patient.email} • {patient.age} anos</p>
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
            
            {filteredPatients.length === 0 && (
              <div className="p-8 text-center text-gray-500">
                Nenhum paciente encontrado.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
