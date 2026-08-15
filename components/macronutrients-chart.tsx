'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { PieChart as PieChartIcon } from 'lucide-react';
import { useState, useEffect } from 'react';

const COLORS = ['#4c8466', '#8b5cf6', '#f59e0b']; // teal-600, purple-500, amber-500

export function MacronutrientsChart() {
  const [data, setData] = useState([
    { name: 'Carboidratos', value: 45 },
    { name: 'Proteínas', value: 30 },
    { name: 'Gorduras', value: 25 },
  ]);

  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMounted(true);
    // Optional: Load data from the current plan or user settings if available
  }, []);

  if (!isMounted) {
    return (
      <Card className="h-full tour-macros">
        <CardHeader>
          <CardTitle className="flex items-center text-slate-800 text-base">
            <PieChartIcon className="w-5 h-5 mr-2 text-teal-600" />
            Metas Diárias
          </CardTitle>
        </CardHeader>
        <CardContent className="h-[250px] flex items-center justify-center">
          <div className="w-8 h-8 rounded-full border-4 border-teal-200 border-t-teal-600 animate-spin"></div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full tour-macros flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center text-slate-800 text-base">
          <PieChartIcon className="w-5 h-5 mr-2 text-teal-600" />
          Metas Diárias
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-[250px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={80}
              paddingAngle={5}
              dataKey="value"
              stroke="none"
            >
              {data.map((entry, index) => (
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
