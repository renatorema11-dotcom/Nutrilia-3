'use client';

import { useAuth } from './auth-provider';
import { getUserData, updateUserData } from '@/lib/db';
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
      if (user) {
        const dbData = await getUserData(user.uid);
        if (dbData?.patientData) {
          const currentWeight = parseFloat(dbData.patientData.weight);
          if (dbData.patientHistory) {
            setData(dbData.patientHistory);
          } else {
            const mockHistory = [
              { month: 'Jan', weight: currentWeight + 3.2, fat: 24.5 },
              { month: 'Fev', weight: currentWeight + 2.1, fat: 23.2 },
              { month: 'Mar', weight: currentWeight + 0.8, fat: 22.0 },
              { month: 'Abr', weight: currentWeight, fat: 21.1 },
            ];
            await updateUserData(user.uid, { patientHistory: mockHistory });
            setData(mockHistory);
          }
        }
      } else {
        const savedData = localStorage.getItem('mockPatientData');
        if (savedData) {
          try {
            const patient = JSON.parse(savedData);
            const currentWeight = parseFloat(patient.weight) || 70;
            
            const savedHistory = localStorage.getItem('mockPatientHistory');
            if (savedHistory) {
              try {
                setData(JSON.parse(savedHistory));
              } catch {
                setData([]);
              }
            } else {
              const mockHistory = [
                { month: 'Jan', weight: currentWeight + 3.2, fat: 24.5 },
                { month: 'Fev', weight: currentWeight + 2.1, fat: 23.2 },
                { month: 'Mar', weight: currentWeight + 0.8, fat: 22.0 },
                { month: 'Abr', weight: currentWeight, fat: 21.1 },
              ];
              localStorage.setItem('mockPatientHistory', JSON.stringify(mockHistory));
              setData(mockHistory);
            }
          } catch (e) {
            console.error('Error parsing patient data or history:', e);
          }
        }
      }
    }
    loadData();
  }, [user]);

  if (data.length === 0) return null;

  return (
    <Card className="w-full h-full flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center text-slate-800">
          <Activity className="w-5 h-5 mr-2 text-teal-600" />
          Evolução de Peso e Gordura
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1">
        <div className="h-[300px] w-full mt-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} />
              <YAxis yAxisId="left" orientation="left" axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} domain={['auto', 'auto']} />
              <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fill: '#64748b' }} domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                itemStyle={{ fontWeight: 'bold' }}
              />
              <Legend verticalAlign="top" height={36} iconType="circle" />
              <Line yAxisId="left" type="monotone" name="Peso (kg)" dataKey="weight" stroke="#0d9488" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
              <Line yAxisId="right" type="monotone" name="Gordura (%)" dataKey="fat" stroke="#8b5cf6" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
