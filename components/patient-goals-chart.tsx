'use client';

import { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Target, Loader2 } from 'lucide-react';
import { getPatients } from '@/lib/patients';

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899'];

export function PatientGoalsChart() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{ name: string; value: number }[]>([]);

  useEffect(() => {
    let isSubscribed = true;
    async function loadData() {
      try {
        const patients = await getPatients();
        if (!isSubscribed) return;

        if (patients.length === 0) {
          setData([]);
          setLoading(false);
          return;
        }

        const counts: Record<string, number> = {};
        patients.forEach((p) => {
          const obj = p.objective || 'Outros';
          counts[obj] = (counts[obj] || 0) + 1;
        });

        const chartData = Object.entries(counts).map(([name, count]) => ({
          name,
          value: count
        }));

        setData(chartData);
      } catch (e) {
        console.error('Error loading patient goals data', e);
      } finally {
        if (isSubscribed) {
          setLoading(false);
        }
      }
    }
    loadData();

    return () => {
      isSubscribed = false;
    };
  }, []);

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center text-slate-800 text-base">
          <Target className="w-5 h-5 mr-2 text-emerald-600" />
          Objetivos dos Pacientes
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[250px] flex items-center justify-center">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-2 text-slate-400 text-xs">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
            <span>Carregando estatísticas...</span>
          </div>
        ) : data.length === 0 ? (
          <div className="text-center text-slate-400 text-xs py-8">
            Nenhum objetivo registrado ainda.
            <br />
            Cadastre pacientes para visualizar estatísticas.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={75}
                paddingAngle={4}
                dataKey="value"
                stroke="none"
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => `${value} paciente(s)`}
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
              />
              <Legend verticalAlign="bottom" height={36} iconType="circle" />
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
