'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Button } from '@/components/ui';
import { Droplet, Plus } from 'lucide-react';
import { motion } from 'motion/react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useAuth } from './auth-provider';
import { updateUserData } from '@/lib/db';
import { db } from '@/lib/firebase';
import { WATER_GOAL_ML, WATER_MAX_ML, dailyKey, waterToday } from '@/lib/daily-log';

export function WaterTracker() {
  const [water, setWater] = useState(0);
  const [isMounted, setIsMounted] = useState(false);
  const goal = WATER_GOAL_ML;
  const { user } = useAuth();

  useEffect(() => {
    setIsMounted(true);
    if (user) {
      // Listener necessário: a Ali também anota a água, por outro serviço, durante a conversa.
      return onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
        setWater(waterToday(snapshot.data()?.waterIntake, new Date(), new Date().toLocaleDateString()));
      }, () => {});
    }
    const saved = localStorage.getItem('mockWaterIntake');
    if (saved) {
      try {
        setWater(waterToday(JSON.parse(saved), new Date(), new Date().toLocaleDateString()));
      } catch (e) {
        console.error(e);
      }
    }
  }, [user]);

  const addWater = async (amount: number) => {
    const newWater = Math.min(water + amount, WATER_MAX_ML);
    setWater(newWater);
    const record = { amount: newWater, date: dailyKey() };
    if (user) {
      await updateUserData(user.uid, { waterIntake: record });
    } else {
      localStorage.setItem('mockWaterIntake', JSON.stringify(record));
    }
  };

  const percentage = Math.min((water / goal) * 100, 100);

  if (!isMounted) {
    return (
      <Card className="h-full tour-water">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-base">
            <div className="flex items-center text-slate-800">
              <Droplet className="w-5 h-5 mr-2 text-blue-500" />
              Água (Hoje)
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-4 w-full bg-slate-100 rounded-full overflow-hidden animate-pulse mb-4"></div>
          <div className="flex gap-2">
            <div className="h-10 flex-1 bg-slate-100 rounded-md animate-pulse"></div>
            <div className="h-10 flex-1 bg-slate-100 rounded-md animate-pulse"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full tour-water">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <div className="flex items-center text-slate-800">
            <Droplet className="w-5 h-5 mr-2 text-blue-500" />
            Água (Hoje)
          </div>
          <span className="text-sm font-normal text-slate-500">
            {water} / {goal} ml
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="h-4 w-full bg-slate-100 rounded-full overflow-hidden relative">
            <motion.div 
              className="absolute top-0 left-0 h-full bg-blue-500"
              initial={{ width: 0 }}
              animate={{ width: `${percentage}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              className="flex-1 border-blue-200 hover:bg-blue-50 hover:text-blue-700 text-blue-600 transition-colors"
              onClick={() => addWater(250)}
            >
              <Plus className="w-4 h-4 mr-1" />
              250ml
            </Button>
            <Button 
              variant="outline" 
              className="flex-1 border-blue-200 hover:bg-blue-50 hover:text-blue-700 text-blue-600 transition-colors"
              onClick={() => addWater(500)}
            >
              <Plus className="w-4 h-4 mr-1" />
              500ml
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
