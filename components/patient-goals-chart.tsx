'use client';

import { useState, useEffect } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Target } from 'lucide-react';

const MOCK_GOALS_DATA = [
  { name: 'Emagrecimento', value: 45 },
  { name: 'Hipertrofia', value: 30 },
  { name: 'Reeducação Alimentar', value: 15 },
  { name: 'Performance Esportiva', value: 10 },
];

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6']; // emerald-500, blue-500, amber-500, purple-500

export function PatientGoalsChart() {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center text-slate-800 text-base">
            <Target className="w-5 h-5 mr-2 text-emerald-600" />
            Objetivos dos Pacientes
          </CardTitle>
        </CardHeader>
        <CardContent className="h-[250px] flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-4 border-emerald-200 border-t-emerald-600 animate-spin"></div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center text-slate-800 text-base">
          <Target className="w-5 h-5 mr-2 text-emerald-600" />
          Objetivos dos Pacientes
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[250px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={MOCK_GOALS_DATA}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={80}
              paddingAngle={5}
              dataKey="value"
              stroke="none"
            >
              {MOCK_GOALS_DATA.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip 
              formatter={(value) => `${value}%`}
              contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
            />
            <Legend verticalAlign="bottom" height={36} iconType="circle" />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
