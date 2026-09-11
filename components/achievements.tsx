'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Award, Flame, Target, Droplets } from 'lucide-react';
import { useState, useEffect } from 'react';

export function Achievements() {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center text-slate-800 text-base">
            <Award className="w-5 h-5 mr-2 text-amber-500" />
            Conquistas
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-6">
          <div className="w-8 h-8 rounded-full border-4 border-amber-200 border-t-amber-500 animate-spin"></div>
        </CardContent>
      </Card>
    );
  }

  // Mock data for achievements
  const achievements = [
    {
      id: 1,
      title: 'Hidratação',
      description: '1.5L / 2L',
      progress: 75,
      icon: <Droplets className="w-6 h-6 text-blue-500" />,
      color: 'bg-blue-500',
      bgColor: 'bg-blue-100',
    },
    {
      id: 2,
      title: 'Refeições',
      description: '3 / 4 Concluídas',
      progress: 75,
      icon: <Target className="w-6 h-6 text-emerald-500" />,
      color: 'bg-emerald-500',
      bgColor: 'bg-emerald-100',
    },
    {
      id: 3,
      title: 'Sequência',
      description: '5 Dias Seguidos',
      progress: 100, // full progress visual for streak
      icon: <Flame className="w-6 h-6 text-orange-500" />,
      color: 'bg-orange-500',
      bgColor: 'bg-orange-100',
    }
  ];

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center text-slate-800 text-base">
          <Award className="w-5 h-5 mr-2 text-amber-500" />
          Conquistas do Dia
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {achievements.map((item) => (
            <div key={item.id} className="flex flex-col p-4 rounded-xl border border-slate-100 bg-white shadow-sm hover:shadow-md transition-shadow">
              <div className="flex justify-between items-start mb-3">
                <div className={`p-2 rounded-lg ${item.bgColor}`}>
                  {item.icon}
                </div>
                {item.progress === 100 && (
                  <span className="flex h-3 w-3 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                  </span>
                )}
              </div>
              <h4 className="font-semibold text-slate-800 text-sm">{item.title}</h4>
              <p className="text-xs text-slate-500 font-medium mb-3">{item.description}</p>
              
              <div className="w-full bg-slate-100 rounded-full h-2 mt-auto">
                <div 
                  className={`h-2 rounded-full ${item.color} transition-all duration-1000 ease-out`}
                  style={{ width: `${item.progress}%` }}
                ></div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
