'use client';

import { MOCK_PATIENT } from '@/lib/mock-data';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function PatientData() {
  const patient = MOCK_PATIENT;
  const latestMeasurement = patient.measurements[patient.measurements.length - 1];

  const chartData = patient.measurements.map(m => ({
    ...m,
    dateFormatted: format(parseISO(m.date), "MMM yy", { locale: ptBR })
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Meus Dados</h1>
        <p className="text-gray-600">Acompanhe sua evolução corporal.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm font-medium text-gray-500">Peso Atual</div>
            <div className="mt-2 flex items-baseline">
              <span className="text-3xl font-bold text-gray-900">{latestMeasurement.weight}</span>
              <span className="ml-1 text-gray-600">kg</span>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm font-medium text-gray-500">Percentual de Gordura</div>
            <div className="mt-2 flex items-baseline">
              <span className="text-3xl font-bold text-gray-900">{latestMeasurement.bodyFat}</span>
              <span className="ml-1 text-gray-600">%</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-sm font-medium text-gray-500">Altura</div>
            <div className="mt-2 flex items-baseline">
              <span className="text-3xl font-bold text-gray-900">{latestMeasurement.height}</span>
              <span className="ml-1 text-gray-600">cm</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Evolução de Peso</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="dateFormatted" axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6B7280', fontSize: 12 }} domain={['dataMin - 2', 'dataMax + 2']} />
                <Tooltip 
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Line type="monotone" dataKey="weight" name="Peso (kg)" stroke="#10B981" strokeWidth={3} dot={{ r: 4, fill: '#10B981' }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
