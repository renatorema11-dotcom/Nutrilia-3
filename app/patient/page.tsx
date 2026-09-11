'use client';

import { Card, CardContent, CardHeader, CardTitle, Button } from '@/components/ui';
import { Calendar, MessageSquare, Apple, Sparkles, Loader2, Download, Settings, Activity, Save, FileText } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useRef } from 'react';
import Markdown from 'react-markdown';
import { handlePrintOrDownload } from '@/lib/print-utils';

import { EvolutionChart } from '@/components/evolution-chart';
import { DailyNutritionTip } from '@/components/daily-nutrition-tip';
import { PatientSettings } from '@/components/patient-settings';
import { GuidedTour } from '@/components/guided-tour';
import { AppointmentScheduler } from '@/components/appointment-scheduler';
import { MacronutrientsChart } from '@/components/macronutrients-chart';
import { WaterTracker } from '@/components/water-tracker';
import { MoodDiary } from '@/components/mood-diary';
import { WeightProgress } from '@/components/weight-progress';
import { FoodDiary } from '@/components/food-diary';
import { Achievements } from '@/components/achievements';
import { useAuth } from '@/components/auth-provider';
import { getUserData, updateUserData } from '@/lib/db';

export default function PatientDashboard() {
  const [patientData, setPatientData] = useState<any>(null);
  const [creativePlan, setCreativePlan] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'settings'>('overview');
  const [observations, setObservations] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [hasPlan, setHasPlan] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { user } = useAuth();

  const handlePrint = () => {
    handlePrintOrDownload(printRef.current, 'Plano Alimentar', creativePlan);
  };

  useEffect(() => {
    const isValidPlanFormat = (data: any) => {
      try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        if (!Array.isArray(parsed)) return false;
        return parsed.every((plan: any) => plan && typeof plan === 'object' && 'id' in plan);
      } catch {
        return false;
      }
    };

    async function loadData() {
      if (user) {
        const data = await getUserData(user.uid);
        if (data?.savedPlans && isValidPlanFormat(data.savedPlans) && data.savedPlans.length > 0) {
          setHasPlan(true);
        }
        if (data?.patientData) {
          setPatientData(data.patientData);
        } else {
          setPatientData({
            name: user.displayName || 'Paciente',
            age: 30,
            weight: 70,
            height: 168,
            initialWeight: 70,
            targetWeight: 65,
            objective: 'Saúde e Bem-Estar'
          });
        }
      } else {
        const savedPlans = localStorage.getItem('mockSavedPlans');
        if (savedPlans && isValidPlanFormat(savedPlans)) {
          try {
            const parsedPlans = JSON.parse(savedPlans);
            if (Array.isArray(parsedPlans) && parsedPlans.length > 0) {
              setHasPlan(true);
            }
          } catch (e) {
            console.error(e);
          }
        }

        const saved = localStorage.getItem('mockPatientData');
        if (saved) {
          try {
            setPatientData(JSON.parse(saved));
          } catch (e) {
            console.error(e);
            setPatientData({
              name: 'Paciente',
              age: 30,
              weight: 70,
              height: 168,
              initialWeight: 70,
              targetWeight: 65,
              objective: 'Saúde e Bem-Estar'
            });
          }
        } else {
          setPatientData({
            name: 'Paciente',
            age: 30,
            weight: 70,
            height: 168,
            initialWeight: 70,
            targetWeight: 65,
            objective: 'Saúde e Bem-Estar'
          });
        }
      }
    }
    loadData();
  }, [user]);

  const generateCreativePlan = async () => {
    if (!patientData) return;
    setIsGenerating(true);
    try {
      const res = await fetch('/api/gemini/generate-creative-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...patientData, observations })
      });
      const data = await res.json();
      if (data.text) {
        setCreativePlan(data.text);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsGenerating(false);
    }
  };

  const savePlan = async () => {
    setIsSaving(true);
    try {
      const newPlan = {
        id: Date.now().toString(),
        date: new Date().toISOString(),
        content: creativePlan,
        objective: patientData.objective
      };
      
      if (user) {
        const data = await getUserData(user.uid);
        const savedPlans = data?.savedPlans || [];
        savedPlans.unshift(newPlan);
        await updateUserData(user.uid, { savedPlans });
      } else {
        const savedPlansStr = localStorage.getItem('mockSavedPlans');
        const savedPlans = savedPlansStr ? JSON.parse(savedPlansStr) : [];
        savedPlans.unshift(newPlan);
        localStorage.setItem('mockSavedPlans', JSON.stringify(savedPlans));
      }
      
      router.push('/patient/plan');
    } catch (error) {
      console.error("Error saving plan:", error);
    } finally {
      setIsSaving(false);
    }
  };

  if (!patientData) return null;

  const renderOverview = () => (
    <>
      {/* Top Row: Key Metrics & Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        <div className="lg:col-span-1 h-full">
          <WeightProgress 
            initialWeight={patientData.initialWeight || patientData.weight + 5} 
            currentWeight={patientData.weight} 
            targetWeight={patientData.targetWeight || patientData.weight - 5} 
          />
        </div>
        <div className="lg:col-span-2 h-full">
          <DailyNutritionTip objective={patientData.objective} />
        </div>
        <div className="lg:col-span-1 h-full">
          <Card className="tour-chat h-full">
            <CardContent className="pt-6 h-full flex flex-col justify-center">
              <div className="flex flex-col items-center text-center space-y-4">
                <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center shadow-sm">
                  <MessageSquare className="w-6 h-6 text-purple-600" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800">Dúvidas?</h3>
                  <p className="text-sm text-slate-600 mt-1">Converse com nosso assistente sobre seu progresso.</p>
                </div>
                <Link href="/patient/chat" className="w-full">
                  <Button variant="outline" className="w-full bg-white/40">Abrir Chat</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Second Row: AI Generator and Appointments */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch mb-6">
        <div className="lg:col-span-2 h-full">
          <Card className="tour-plan-generator h-full flex flex-col gap-4">
            <CardHeader className="pb-0">
            <CardTitle className="flex items-center text-teal-800">
              <Sparkles className="w-5 h-5 mr-2 text-teal-600" />
              Ideias Criativas com IA
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-slate-600 mb-4 text-sm">
              Que tal fugir da rotina? Peça para nossa Inteligência Artificial criar um cardápio diário inovador, totalmente focado no seu objetivo de <strong>{patientData.objective}</strong>!
            </p>
            
            {!creativePlan && !isGenerating && (
              <div className="space-y-4">
                <div>
                  <label htmlFor="observations" className="block text-sm font-medium text-slate-700 mb-1">
                    Observações e Preferências
                  </label>
                  <textarea
                    id="observations"
                    value={observations}
                    onChange={(e) => setObservations(e.target.value)}
                    placeholder="Ex: Não gosto de peixe, quero algo prático para levar pro trabalho..."
                    className="w-full rounded-lg bg-white/80 border border-white/50 px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 shadow-sm transition-shadow min-h-[80px]"
                  />
                </div>
                <Button onClick={generateCreativePlan} className="bg-teal-600 hover:bg-teal-700 text-white flex items-center gap-2 w-full sm:w-auto">
                  <Sparkles className="w-4 h-4" />
                  Gerar Cardápio Criativo
                </Button>
              </div>
            )}

            {isGenerating && (
              <div className="flex items-center gap-2 text-teal-600 text-sm font-semibold">
                <Loader2 className="w-4 h-4 animate-spin" />
                Criando um cardápio incrível...
              </div>
            )}

            {creativePlan && !isGenerating && (
              <div className="mt-4 bg-white/50 border border-white/60 p-4 rounded-xl">
                <div ref={printRef} className="markdown-body text-sm text-slate-700 space-y-4 p-4">
                  <Markdown>{creativePlan}</Markdown>
                </div>
                <div className="flex flex-col sm:flex-row gap-2 mt-4">
                  <Button onClick={savePlan} disabled={isSaving} className="bg-teal-600 hover:bg-teal-700 text-white flex-1 text-xs h-9">
                    {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                    Salvar Plano
                  </Button>
                  <Button onClick={() => handlePrint()} className="bg-teal-600 hover:bg-teal-700 text-white flex-1 text-xs h-9">
                    <Download className="w-4 h-4 mr-2" />
                    Exportar PDF
                  </Button>
                  <Button onClick={() => { if (window.confirm('Você tem certeza?')) setCreativePlan(''); }} variant="outline" className="flex-1 text-xs h-9">
                    Gerar nova opção
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        </div>

        <div className="lg:col-span-1 h-full">
          <AppointmentScheduler currentPatientName={patientData.name} />
        </div>
      </div>
      
      {hasPlan ? (
        <div className="flex flex-col gap-6 mt-6">
          <div className="w-full">
            <Achievements />
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="tour-evolution lg:col-span-2 h-full">
              <EvolutionChart />
            </div>
            <div className="lg:col-span-1 h-full">
              <MacronutrientsChart />
            </div>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
            <div className="lg:col-span-2 h-full">
              <FoodDiary />
            </div>
            <div className="lg:col-span-1 flex flex-col gap-6">
              <div className="flex-1">
                <WaterTracker />
              </div>
              <div className="flex-1">
                <MoodDiary />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-6 border border-slate-200 border-dashed rounded-xl p-12 flex flex-col items-center justify-center text-center bg-white/50">
          <FileText className="w-12 h-12 text-slate-300 mb-4" />
          <h3 className="text-lg font-medium text-slate-800">Nenhum plano alimentar ativo</h3>
          <p className="text-slate-600 mt-2 max-w-md">Para visualizar seu diário de refeições, metas e evolução, gere um novo plano criativo com IA e salve-o em seus planos.</p>
        </div>
      )}
    </>
  );

  return (
    <div className="space-y-6">
      <GuidedTour />
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-bold text-slate-800">Olá, {patientData.name.split(' ')[0]}</h1>
          <p className="text-slate-600">Bem-vindo(a) de volta ao seu painel.</p>
          
          <div className="flex gap-4 mt-2">
            <span className="text-xs font-semibold bg-white/40 border border-white/50 text-slate-700 px-3 py-1 rounded-full shadow-sm">Objetivo: {patientData.objective}</span>
            <span className="text-xs font-semibold bg-white/40 border border-white/50 text-slate-700 px-3 py-1 rounded-full shadow-sm">Peso: {patientData.weight}kg</span>
          </div>
        </div>

        <div className="flex bg-white/50 p-1 rounded-lg border border-white/60 w-full md:w-auto self-start">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'overview' ? 'bg-white shadow-sm text-teal-700' : 'text-slate-600 hover:text-slate-900'}`}
          >
            <Activity className="w-4 h-4" />
            Visão Geral
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex-1 md:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${activeTab === 'settings' ? 'bg-white shadow-sm text-teal-700' : 'text-slate-600 hover:text-slate-900'}`}
          >
            <Settings className="w-4 h-4" />
            Configurações
          </button>
        </div>
      </div>

      {activeTab === 'overview' ? (
        renderOverview()
      ) : (
        <div className="pt-2">
          <PatientSettings 
            patientData={patientData} 
            onSave={(newData) => {
              setPatientData(newData);
              // Dispara um evento para o gráfico de evolução atualizar, ou apenas force um refresh do componente
              window.dispatchEvent(new Event('storage'));
            }} 
          />
        </div>
      )}
    </div>
  );
}
