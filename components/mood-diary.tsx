'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Smile, Frown, Meh, Heart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from './auth-provider';
import { getUserData, updateUserData } from '@/lib/db';

type Mood = 'sad' | 'neutral' | 'happy' | 'great';

const MOODS = [
  { value: 'sad', icon: Frown, label: 'Triste', color: 'text-rose-500', bgColor: 'bg-rose-50', hoverColor: 'hover:bg-rose-100' },
  { value: 'neutral', icon: Meh, label: 'Neutro', color: 'text-amber-500', bgColor: 'bg-amber-50', hoverColor: 'hover:bg-amber-100' },
  { value: 'happy', icon: Smile, label: 'Feliz', color: 'text-teal-500', bgColor: 'bg-teal-50', hoverColor: 'hover:bg-teal-100' },
  { value: 'great', icon: Heart, label: 'Ótimo', color: 'text-purple-500', bgColor: 'bg-purple-50', hoverColor: 'hover:bg-purple-100' },
] as const;

export function MoodDiary() {
  const [selectedMood, setSelectedMood] = useState<Mood | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    setIsMounted(true);
    async function loadData() {
      if (user) {
        const data = await getUserData(user.uid);
        if (data?.moodDiary?.date === new Date().toLocaleDateString()) {
          setSelectedMood(data.moodDiary.mood);
        }
      } else {
        const saved = localStorage.getItem('mockMoodDiary');
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (parsed.date === new Date().toLocaleDateString()) {
              setSelectedMood(parsed.mood);
            }
          } catch (e) {
            console.error(e);
          }
        }
      }
    }
    loadData();
  }, [user]);

  const handleSelectMood = async (mood: Mood) => {
    setSelectedMood(mood);
    if (user) {
      await updateUserData(user.uid, {
        moodDiary: {
          mood,
          date: new Date().toLocaleDateString()
        }
      });
    } else {
      localStorage.setItem('mockMoodDiary', JSON.stringify({
        mood,
        date: new Date().toLocaleDateString()
      }));
    }
  };

  if (!isMounted) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center text-slate-800">
            <Smile className="w-5 h-5 mr-2 text-amber-500" />
            Como você se sente hoje?
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-between items-center mt-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="w-12 h-12 bg-slate-100 rounded-full animate-pulse"></div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center text-slate-800">
          <Smile className="w-5 h-5 mr-2 text-amber-500" />
          Como você se sente hoje?
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex justify-between items-center mt-2">
          {MOODS.map((mood) => {
            const Icon = mood.icon;
            const isSelected = selectedMood === mood.value;
            
            return (
              <button
                key={mood.value}
                onClick={() => handleSelectMood(mood.value)}
                className={cn(
                  "flex flex-col items-center justify-center p-2 rounded-xl transition-all duration-200",
                  isSelected ? `${mood.bgColor} scale-110 shadow-sm` : `hover:scale-105 ${mood.hoverColor} opacity-70 hover:opacity-100`
                )}
                title={mood.label}
              >
                <Icon className={cn("w-8 h-8 mb-1", isSelected ? mood.color : "text-slate-400")} />
                <span className={cn("text-[10px] font-medium", isSelected ? mood.color : "text-slate-400")}>
                  {mood.label}
                </span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
