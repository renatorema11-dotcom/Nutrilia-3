'use client';

import { useAuth } from './auth-provider';
import { getUserData } from '@/lib/db';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Activity } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

export function EvolutionChart() {
  const [data, setData] = useState<any[]>([]);
  const { user } = useAuth();

  useEffect(() => {
    async function loadData() {
      if (!user) return;
      // Só medições de verdade, vindas do prontuário: nada de histórico de exemplo.
      const dbData = await getUserData(user.uid);
      const measurements = Array.isArray(dbData?.patientData?.measurements) ? dbData.patientData.measurements : [];
      setData(measurements
        .filter((m: any) => m && typeof m.weight === 'number' && typeof m.date === 'string')
        .map((m: any) => ({
          month: m.date.split('-').reverse().slice(0, 2).join('/'),
          weight: m.weight,
          fat: typeof m.bodyFat === 'number' ? m.bodyFat : undefined,
        })));
    }
    loadData();
  }, [user]);

  // Com menos de duas medições ainda não existe evolução para mostrar.
  if (data.length < 2) return null;
  // A linha de gordura só aparece se a nutricionista registrou esse dado.
  const hasFat = data.some((point) => typeof point.fat === 'number');

  return (
    <Card className="w-full h-full flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center text-slate-800">
          <Activity className="w-5 h-5 mr-2 text-teal-600" />
          {hasFat ? 'Evolução de Peso e Gordura' : 'Evolução de Peso'}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        <div className="h-[300px] w-full mt-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} />
              <YAxis yAxisId="left" orientation="left" axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} domain={['auto', 'auto']} />
              {hasFat && <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} domain={['auto', 'auto']} />}
              <Tooltip
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                itemStyle={{ fontWeight: 'bold' }}
              />
              <Legend verticalAlign="top" height={36} iconType="circle" />
              <Line yAxisId="left" type="monotone" name="Peso (kg)" dataKey="weight" stroke="#0d9488" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
              {hasFat && <Line yAxisId="right" type="monotone" name="Gordura (%)" dataKey="fat" stroke="#8b5cf6" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} connectNulls />}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
