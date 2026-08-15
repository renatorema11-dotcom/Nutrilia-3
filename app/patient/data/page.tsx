'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useAuth } from '@/components/auth-provider';
import { getUserData } from '@/lib/db';

export default function PatientData() {
  const { user } = useAuth();
  const [patientData, setPatientData] = useState<any>(null);

  useEffect(() => {
    async function loadData() {
      if (user) {
        const data = await getUserData(user.uid);
        if (data?.patientData) {
          setPatientData(data.patientData);
          return;
        }
      }

      const saved = localStorage.getItem('mockPatientData');
      if (saved) {
        try {
          setPatientData(JSON.parse(saved));
          return;
        } catch {
          // fallback
        }
      }

      // Default user data when no custom values are saved yet
      setPatientData({
        name: user?.displayName || 'Paciente',
        weight: 70,
        height: 168,
        targetWeight: 65,
        initialWeight: 75,
        objective: 'Saúde e Bem-Estar',
        measurements: [
          { date: new Date().toISOString().split('T')[0], weight: 70, height: 168 }
        ]
      });
    }

    loadData();
  }, [user]);

  if (!patientData) {
    return <div className="p-8 text-center text-slate-500">Carregando dados...</div>;
  }

  const measurements = patientData.measurements && patientData.measurements.length > 0
    ? patientData.measurements
    : [{ date: new Date().toISOString().split('T')[0], weight: patientData.weight, height: patientData.height }];

  const latestMeasurement = measurements[measurements.length - 1];

  const chartData = measurements.map((m: any) => ({
    ...m,
    dateFormatted: m.date
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Meus Dados</h1>
        <p className="text-gray-600">Acompanhe sua evolução corporal em tempo real.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-sm font-medium text-gray-500">Peso Atual</div>
            <div className="mt-2 flex items-baseline">
              <span className="text-3xl font-bold text-gray-900">{latestMeasurement.weight || patientData.weight}</span>
              <span className="ml-1 text-gray-600">kg</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-sm font-medium text-gray-500">Meta de Peso</div>
            <div className="mt-2 flex items-baseline">
              <span className="text-3xl font-bold text-emerald-600">{patientData.targetWeight || '-'}</span>
              <span className="ml-1 text-gray-600">kg</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="text-sm font-medium text-gray-500">Altura</div>
            <div className="mt-2 flex items-baseline">
              <span className="text-3xl font-bold text-gray-900">{latestMeasurement.height || patientData.height}</span>
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
