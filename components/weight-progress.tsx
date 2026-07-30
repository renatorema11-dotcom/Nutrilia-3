'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Target, TrendingDown, TrendingUp } from 'lucide-react';
import { motion } from 'motion/react';

interface WeightProgressProps {
  initialWeight: number;
  currentWeight: number;
  targetWeight: number;
}

export function WeightProgress({ initialWeight, currentWeight, targetWeight }: WeightProgressProps) {
  const initial = Number(initialWeight) || 0;
  const current = Number(currentWeight) || 0;
  const target = Number(targetWeight) || 0;

  const isLosingWeight = target < initial;
  
  // Calculate progress percentage
  // If losing weight: 100% means we reached or surpassed the target (went lower).
  // If gaining weight: 100% means we reached or surpassed the target (went higher).
  const totalDifference = Math.abs(initial - target);
  const currentDifference = Math.abs(initial - current);
  
  let percentage = totalDifference > 0 ? (currentDifference / totalDifference) * 100 : 0;
  
  // Cap at 100% and ensure it doesn't go below 0%
  if (isLosingWeight && current > initial) percentage = 0;
  if (!isLosingWeight && current < initial) percentage = 0;
  
  percentage = Math.min(Math.max(percentage, 0), 100);

  const remaining = Math.abs(current - target);

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center text-slate-800">
          <Target className="w-5 h-5 mr-2 text-indigo-500" />
          Meta vs Atual
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex justify-between items-end">
            <div>
              <p className="text-3xl font-bold text-slate-800">
                {current.toFixed(1)} <span className="text-sm font-normal text-slate-500">kg</span>
              </p>
              <p className="text-sm text-slate-500 flex items-center mt-1">
                {isLosingWeight ? (
                  <TrendingDown className="w-4 h-4 mr-1 text-emerald-500" />
                ) : (
                  <TrendingUp className="w-4 h-4 mr-1 text-emerald-500" />
                )}
                Faltam {remaining.toFixed(1)} kg para a meta
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium text-indigo-600">Alvo</p>
              <p className="text-xl font-semibold text-slate-800">{target.toFixed(1)} kg</p>
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-xs text-slate-500 font-medium">
              <span>{initial} kg</span>
              <span>{Math.round(percentage)}%</span>
            </div>
            <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden relative">
              <motion.div 
                className="absolute top-0 left-0 h-full bg-indigo-500"
                initial={{ width: 0 }}
                animate={{ width: `${percentage}%` }}
                transition={{ duration: 1, ease: "easeOut" }}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
