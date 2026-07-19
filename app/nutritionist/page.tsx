import { MOCK_NUTRITIONIST, MOCK_PATIENTS_LIST } from '@/lib/mock-data';
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from '@/components/ui';
import { AlertCircle, Bell, Clock, ChevronRight } from 'lucide-react';
import Link from 'next/link';

export default function NutritionistDashboard() {
  const nutritionist = MOCK_NUTRITIONIST;
  const recentPatients = MOCK_PATIENTS_LIST.slice(0, 3);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Olá, {nutritionist.name}</h1>
        <p className="text-gray-600">Resumo do seu consultório hoje.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Bell className="w-5 h-5 mr-2 text-amber-500" />
              Alertas da IA
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {nutritionist.alerts.map((alert) => (
                <div key={alert.id} className="flex items-start p-3 bg-amber-50 rounded-lg border border-amber-100">
                  <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 mr-3 flex-shrink-0" />
                  <p className="text-amber-900 text-sm">{alert.message}</p>
                </div>
              ))}
            </div>
            <div className="mt-6">
              <Link href="/nutritionist/assistant">
                <Button variant="outline" className="w-full">Abrir Assistente Completo</Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Clock className="w-5 h-5 mr-2 text-blue-500" />
              Próximas Consultas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between items-center border-b pb-2">
                <div>
                  <p className="font-medium text-gray-900">Maria Souza</p>
                  <p className="text-xs text-gray-500">Amanhã, 14:00</p>
                </div>
                <Badge variant="warning">Retorno</Badge>
              </div>
              <div className="flex justify-between items-center border-b pb-2">
                <div>
                  <p className="font-medium text-gray-900">Carlos Oliveira</p>
                  <p className="text-xs text-gray-500">25/07, 09:00</p>
                </div>
                <Badge variant="default">Primeira</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Pacientes Recentes</CardTitle>
          <Link href="/nutritionist/patients" className="text-sm font-medium text-emerald-600 hover:text-emerald-500 flex items-center">
            Ver todos <ChevronRight className="w-4 h-4 ml-1" />
          </Link>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-500 uppercase bg-gray-50">
                <tr>
                  <th className="px-4 py-3 font-medium rounded-tl-lg">Nome</th>
                  <th className="px-4 py-3 font-medium">Status do Plano</th>
                  <th className="px-4 py-3 font-medium rounded-tr-lg text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {recentPatients.map((patient) => (
                  <tr key={patient.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/50">
                    <td className="px-4 py-4 font-medium text-gray-900">{patient.name}</td>
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
        </CardContent>
      </Card>
    </div>
  );
}
