'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { BookOpen, Check, X, Edit3, Save, Sparkles, AlertCircle, Camera, ImageIcon } from 'lucide-react';
import { MOCK_PATIENT } from '@/lib/mock-data';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui';
import { useAuth } from './auth-provider';
import { getUserData, updateUserData } from '@/lib/db';

type MealStatus = 'followed' | 'different' | 'skipped' | null;

interface MealEntry {
  status: MealStatus;
  notes: string;
  image?: string | null;
  aiFeedback?: string;
  aiStatus?: 'positive' | 'neutral' | 'negative' | 'corrective';
}

export function FoodDiary() {
  const [entries, setEntries] = useState<Record<string, MealEntry>>({});
  const [editingMeal, setEditingMeal] = useState<string | null>(null);
  const [analyzingMeal, setAnalyzingMeal] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [editImage, setEditImage] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [hasPlan, setHasPlan] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { user } = useAuth();

  // Using the first day plan (Segunda a Sexta) as a default for the diary
  const todayMeals = hasPlan ? (MOCK_PATIENT.currentPlan?.days[0].meals || []) : [];

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMounted(true);
    async function loadData() {
      if (user) {
        const data = await getUserData(user.uid);
        if (data?.savedPlans && data.savedPlans.length > 0) {
          setHasPlan(true);
        }
        if (data?.foodDiary?.date === new Date().toLocaleDateString()) {
          setEntries(data.foodDiary.entries || {});
        }
      } else {
        const savedPlans = localStorage.getItem('mockSavedPlans');
        if (savedPlans && JSON.parse(savedPlans).length > 0) {
          setHasPlan(true);
        }
        const saved = localStorage.getItem('mockFoodDiary');
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            if (parsed.date === new Date().toLocaleDateString()) {
              setEntries(parsed.entries || {});
            }
          } catch (e) {
            console.error(e);
          }
        }
      }
    }
    loadData();
  }, [user]);

  const saveEntries = async (newEntries: Record<string, MealEntry>) => {
    setEntries(newEntries);
    if (user) {
      await updateUserData(user.uid, {
        foodDiary: {
          entries: newEntries,
          date: new Date().toLocaleDateString()
        }
      });
    } else {
      localStorage.setItem('mockFoodDiary', JSON.stringify({
        entries: newEntries,
        date: new Date().toLocaleDateString()
      }));
    }
  };

  const handleStatusUpdate = (mealName: string, status: MealStatus) => {
    const newEntries = { ...entries };
    if (!newEntries[mealName]) {
      newEntries[mealName] = { status, notes: '' };
    } else {
      newEntries[mealName].status = status;
    }
    
    if (status === 'different') {
      setEditingMeal(mealName);
      setNotes(newEntries[mealName].notes || '');
      setEditImage(newEntries[mealName].image || null);
    }
    
    saveEntries(newEntries);
  };

  const handleImageCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveNotes = async (mealName: string, plannedItems: string[]) => {
    const newEntries = { ...entries };
    if (newEntries[mealName]) {
      newEntries[mealName].notes = notes;
      newEntries[mealName].image = editImage;
      newEntries[mealName].aiFeedback = undefined;
      newEntries[mealName].aiStatus = undefined;
    }
    saveEntries(newEntries);
    setEditingMeal(null);

    setAnalyzingMeal(mealName);
    try {
      const res = await fetch('/api/analyze-food', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mealName,
          plannedItems: plannedItems.join(', '),
          actualNotes: notes,
          image: editImage, // Send base64 image if available
          objective: MOCK_PATIENT.objective || 'Manutenção'
        })
      });
      const data = await res.json();
      
      // Update state using functional update to ensure we have the latest state
      let updatedEntries: Record<string, MealEntry> = {};
      setEntries(prev => {
        const updated = { ...prev };
        if (updated[mealName]) {
          updated[mealName].aiFeedback = data.feedback;
          updated[mealName].aiStatus = data.status;
        }
        updatedEntries = updated;
        return updated;
      });
      
      if (user) {
        await updateUserData(user.uid, {
          foodDiary: {
            entries: updatedEntries,
            date: new Date().toLocaleDateString()
          }
        });
      } else {
        localStorage.setItem('mockFoodDiary', JSON.stringify({
          entries: updatedEntries,
          date: new Date().toLocaleDateString()
        }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setAnalyzingMeal(null);
    }
  };

  if (!isMounted) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center text-slate-800">
            <BookOpen className="w-5 h-5 mr-2 text-indigo-500" />
            Diário Alimentar
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-4 mt-2">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-20 bg-slate-100 rounded-lg"></div>
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
          <BookOpen className="w-5 h-5 mr-2 text-indigo-500" />
          Diário Alimentar
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 mt-2">
        {!hasPlan && (
          <div className="text-center py-6">
            <p className="text-slate-600 text-sm">Aguardando seu plano alimentar...</p>
            <p className="text-slate-500 text-xs mt-1">Quando você tiver um plano, suas refeições aparecerão aqui.</p>
          </div>
        )}
        {todayMeals.map((meal) => {
          const entry = entries[meal.name] || { status: null, notes: '' };
          const isEditing = editingMeal === meal.name;

          return (
            <div key={meal.name} className="border border-slate-100 rounded-lg p-3 bg-white shadow-sm">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <h4 className="font-semibold text-slate-800 flex items-center text-sm">
                    {meal.name}
                    <span className="text-xs font-normal text-slate-500 ml-2 bg-slate-100 px-2 py-0.5 rounded-full">
                      {meal.time}
                    </span>
                  </h4>
                  <p className="text-xs text-slate-600 mt-1 line-clamp-1" title={meal.items.join(', ')}>
                    {meal.items.join(', ')}
                  </p>
                </div>
              </div>

              {isEditing ? (
                <div className="mt-3 space-y-2">
                  <textarea
                    className="w-full text-sm p-2 border rounded-md focus:ring-1 focus:ring-indigo-500 outline-none"
                    placeholder="O que você comeu?"
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                  
                  {editImage && (
                    <div className="relative w-full h-32 rounded-md overflow-hidden bg-slate-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={editImage} alt="Foto da refeição" className="w-full h-full object-cover" />
                      <button 
                        onClick={() => setEditImage(null)}
                        className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1 hover:bg-black/70"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  <div className="flex justify-between items-center gap-2">
                    <div>
                      <input 
                        type="file" 
                        accept="image/*" 
                        capture="environment" 
                        className="hidden" 
                        ref={fileInputRef}
                        onChange={handleImageCapture}
                      />
                      <Button 
                        variant="outline" 
                        className="h-8 px-3 text-xs" 
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Camera className="w-4 h-4 mr-1" />
                        {editImage ? 'Trocar Foto' : 'Tirar Foto'}
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" className="h-8 px-3 text-xs" onClick={() => setEditingMeal(null)}>
                        Cancelar
                      </Button>
                      <Button className="h-8 px-3 text-xs" onClick={() => handleSaveNotes(meal.name, meal.items)}>
                        <Save className="w-4 h-4 mr-1" /> Salvar
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-3">
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleStatusUpdate(meal.name, 'followed')}
                      className={cn(
                        "flex-1 text-xs py-1.5 px-2 rounded-md border flex items-center justify-center transition-colors",
                        entry.status === 'followed' 
                          ? "bg-emerald-50 border-emerald-200 text-emerald-700 font-medium" 
                          : "hover:bg-slate-50 text-slate-600 border-slate-200"
                      )}
                    >
                      <Check className="w-3.5 h-3.5 mr-1" /> Segui
                    </button>
                    <button
                      onClick={() => handleStatusUpdate(meal.name, 'different')}
                      className={cn(
                        "flex-1 text-xs py-1.5 px-2 rounded-md border flex items-center justify-center transition-colors",
                        entry.status === 'different' 
                          ? "bg-amber-50 border-amber-200 text-amber-700 font-medium" 
                          : "hover:bg-slate-50 text-slate-600 border-slate-200"
                      )}
                    >
                      <Edit3 className="w-3.5 h-3.5 mr-1" /> Alterei
                    </button>
                    <button
                      onClick={() => handleStatusUpdate(meal.name, 'skipped')}
                      className={cn(
                        "flex-1 text-xs py-1.5 px-2 rounded-md border flex items-center justify-center transition-colors",
                        entry.status === 'skipped' 
                          ? "bg-rose-50 border-rose-200 text-rose-700 font-medium" 
                          : "hover:bg-slate-50 text-slate-600 border-slate-200"
                      )}
                    >
                      <X className="w-3.5 h-3.5 mr-1" /> Pulei
                    </button>
                  </div>

                  {entry.status === 'different' && entry.notes && (
                    <div className="mt-2 space-y-2">
                      <div className="p-2 bg-slate-50 rounded-md text-xs text-slate-700 flex justify-between items-start">
                        <div className="space-y-2 w-full">
                          <p><strong>Consumo real:</strong> {entry.notes}</p>
                          {entry.image && (
                            <div className="w-full h-24 rounded-md overflow-hidden bg-slate-200 mt-2">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={entry.image} alt="Foto da refeição" className="w-full h-full object-cover" />
                            </div>
                          )}
                        </div>
                        <button 
                          onClick={() => {
                            setEditingMeal(meal.name);
                            setNotes(entry.notes);
                            setEditImage(entry.image || null);
                          }}
                          className="text-indigo-600 hover:text-indigo-800 ml-2 whitespace-nowrap shrink-0"
                        >
                          Editar
                        </button>
                      </div>
                      
                      {analyzingMeal === meal.name ? (
                        <div className="p-2 bg-indigo-50 rounded-md flex items-center gap-2 text-xs text-indigo-700 animate-pulse">
                          <Sparkles className="w-3.5 h-3.5" />
                          Analisando com IA...
                        </div>
                      ) : entry.aiFeedback ? (
                        <div className={cn(
                          "p-2 rounded-md text-xs flex items-start gap-2 border",
                          entry.aiStatus === 'positive' ? "bg-emerald-50 text-emerald-800 border-emerald-100" :
                          entry.aiStatus === 'corrective' ? "bg-amber-50 text-amber-800 border-amber-100" :
                          entry.aiStatus === 'negative' ? "bg-rose-50 text-rose-800 border-rose-100" :
                          "bg-blue-50 text-blue-800 border-blue-100"
                        )}>
                          {entry.aiStatus === 'positive' ? <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" /> :
                           entry.aiStatus === 'corrective' ? <Sparkles className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" /> :
                           <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                          <p>{entry.aiFeedback}</p>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
