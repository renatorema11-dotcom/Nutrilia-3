'use client';

import { useState, useEffect, use } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Input } from '@/components/ui';
import { ArrowLeft, Clock, Wand2, CheckCircle2, Plus, Loader2, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getPatientById, updatePatient, deletePatient, Patient, Plan } from '@/lib/patients';

export default function PatientProfile({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const router = useRouter();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [draftPlan, setDraftPlan] = useState<any>(null);

  // New Measurement state
  const [showAddMeasure, setShowAddMeasure] = useState(false);
  const [newWeight, setNewWeight] = useState('');
  const [newFat, setNewFat] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const data = await getPatientById(resolvedParams.id);
        if (data) {
          setPatient(data);
          if (data.currentPlan?.status === 'draft') {
            setDraftPlan(data.currentPlan);
          }
        }
      } catch (e) {
        console.error('Erro ao carregar prontuário:', e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [resolvedParams.id]);

  if (loading) {
    return (
      <div className="p-12 text-center text-slate-500 flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
        <p>Carregando prontuário do paciente...</p>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="space-y-4">
        <Link href="/nutritionist/patients" className="inline-flex items-center text-sm font-medium text-emerald-600 hover:text-emerald-700">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Voltar para Pacientes
        </Link>
        <div className="p-8 bg-white rounded-xl shadow-sm border border-slate-100 text-center">
          <p className="text-gray-600 font-medium">Paciente não encontrado.</p>
        </div>
      </div>
    );
  }

  const handleGeneratePlan = async () => {
    setGenerating(true);
    try {
      const lastMeasure = patient.measurements?.[patient.measurements.length - 1] || {
        weight: patient.weight,
        height: patient.height
      };

      const res = await fetch('/api/gemini/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientContext: JSON.stringify({
            nome: patient.name,
            idade: patient.age,
            objetivo: patient.objective,
            pesoAtual: lastMeasure.weight,
            altura: lastMeasure.height || patient.height,
          }),
          instructions
        })
      });
      const json = await res.json();
      if (json.data) {
        const generatedDraft: Plan = {
          id: 'plan_' + Date.now(),
          status: 'draft',
          createdDate: new Date().toISOString().split('T')[0],
          days: json.data.days
        };
        setDraftPlan(generatedDraft);
        await updatePatient(patient.id, { currentPlan: generatedDraft });
        setPatient({ ...patient, currentPlan: generatedDraft });
      } else {
        alert('Não foi possível gerar o plano. Tente novamente.');
      }
    } catch (e) {
      console.error(e);
      alert('Erro ao gerar plano.');
    } finally {
      setGenerating(false);
    }
  };

  const handleApprovePlan = async () => {
    if (!draftPlan) return;
    const approvedPlan: Plan = {
      ...draftPlan,
      status: 'approved'
    };
    await updatePatient(patient.id, { currentPlan: approvedPlan });
    setPatient({ ...patient, currentPlan: approvedPlan });
    setDraftPlan(null);
    alert('Plano aprovado com sucesso! Liberado para o paciente.');
  };

  const handleDiscardPlan = async () => {
    await updatePatient(patient.id, { currentPlan: null });
    setPatient({ ...patient, currentPlan: null });
    setDraftPlan(null);
  };

  const handleAddMeasurement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWeight || Number(newWeight) <= 0) return;

    const today = new Date().toISOString().split('T')[0];
    const newM = {
      date: today,
      weight: Number(newWeight),
      bodyFat: newFat ? Number(newFat) : undefined,
      height: patient.height
    };

    const updatedMeasurements = [...(patient.measurements || []), newM];
    await updatePatient(patient.id, {
      measurements: updatedMeasurements,
      weight: Number(newWeight)
    });

    setPatient({
      ...patient,
      weight: Number(newWeight),
      measurements: updatedMeasurements
    });

    setNewWeight('');
    setNewFat('');
    setShowAddMeasure(false);
  };

  const handleDeletePatient = async () => {
    if (window.confirm(`Tem certeza que deseja remover ${patient.name}?`)) {
      await deletePatient(patient.id);
      router.push('/nutritionist/patients');
    }
  };

  const planStatus = patient.currentPlan?.status || (draftPlan ? 'draft' : 'none');
  const currentPlan = patient.currentPlan || draftPlan;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/nutritionist/patients" className="inline-flex items-center text-sm font-medium text-emerald-600 hover:text-emerald-700 mb-4">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Voltar para Pacientes
        </Link>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{patient.name}</h1>
            <p className="text-gray-600">{patient.email} • {patient.age} anos • Objetivo: {patient.objective}</p>
          </div>
          <div className="flex items-center gap-3">
            {planStatus === 'approved' && <Badge variant="success">Plano Ativo</Badge>}
            {planStatus === 'draft' && <Badge variant="warning">Rascunho Pendente</Badge>}
            {planStatus === 'none' && <Badge variant="default">Sem Plano</Badge>}
            <button
              onClick={handleDeletePatient}
              className="p-2 text-red-500 hover:bg-red-50 rounded-lg text-xs flex items-center gap-1 border border-red-200 transition-colors"
              title="Excluir paciente"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle>Histórico de Medidas</CardTitle>
              <Button
                variant="outline"
                onClick={() => setShowAddMeasure(!showAddMeasure)}
                className="text-xs h-8 px-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Nova Medida
              </Button>
            </CardHeader>
            <CardContent>
              {showAddMeasure && (
                <form onSubmit={handleAddMeasurement} className="mb-4 p-3 bg-emerald-50/60 rounded-lg border border-emerald-100 space-y-3">
                  <p className="text-xs font-semibold text-emerald-900">Registrar nova pesagem</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-slate-600">Peso (kg)</label>
                      <Input
                        type="number"
                        step="0.1"
                        placeholder="Ex: 71.2"
                        value={newWeight}
                        onChange={(e) => setNewWeight(e.target.value)}
                        required
                        className="h-8 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-600">% Gordura</label>
                      <Input
                        type="number"
                        step="0.1"
                        placeholder="Ex: 19.5"
                        value={newFat}
                        onChange={(e) => setNewFat(e.target.value)}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <Button type="button" variant="ghost" onClick={() => setShowAddMeasure(false)} className="h-7 text-xs px-2">
                      Cancelar
                    </Button>
                    <Button type="submit" className="bg-emerald-600 text-white h-7 text-xs px-3">
                      Salvar
                    </Button>
                  </div>
                </form>
              )}

              {patient.measurements && patient.measurements.length > 0 ? (
                <div className="space-y-3 divide-y divide-slate-100">
                  {[...patient.measurements].reverse().map((m, idx) => (
                    <div key={idx} className="pt-2 first:pt-0 flex justify-between text-sm">
                      <div>
                        <p className="font-semibold text-slate-800">{m.weight} kg</p>
                        <p className="text-xs text-slate-400">{m.date}</p>
                      </div>
                      <div className="text-right">
                        {m.bodyFat && <p className="text-xs text-slate-600">{m.bodyFat}% gordura</p>}
                        {m.height && <p className="text-xs text-slate-400">{m.height} cm</p>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-sm">Nenhuma medida cadastrada.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Plano Alimentar</CardTitle>
            </CardHeader>
            <CardContent>
              {planStatus === 'none' && (
                <div className="bg-emerald-50 rounded-lg p-6 border border-emerald-100 space-y-4">
                  <h3 className="font-medium text-emerald-900 flex items-center">
                    <Wand2 className="h-5 w-5 mr-2 text-emerald-600" />
                    Gerar Plano Personalizado com IA
                  </h3>
                  <p className="text-sm text-emerald-700">
                    A Inteligência Artificial criará um plano alimentar sob medida para o objetivo de <strong>{patient.objective}</strong>.
                  </p>
                  <Input
                    id="inst"
                    placeholder="Instruções adicionais (ex: Sem pimentão, dieta rica em fibras, intolerante a lactose...)"
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                  />
                  <Button onClick={handleGeneratePlan} disabled={generating} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
                    {generating ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Elaborando rascunho com Gemini...
                      </>
                    ) : (
                      'Gerar Rascunho com IA'
                    )}
                  </Button>
                </div>
              )}

              {planStatus === 'approved' && currentPlan && (
                <div className="space-y-6">
                  {currentPlan.days?.map((day: any, idx: number) => (
                    <div key={idx} className="space-y-4">
                      <h4 className="font-bold text-slate-800 border-b pb-2">{day.name}</h4>
                      {day.meals?.map((meal: any, mIdx: number) => (
                        <div key={mIdx} className="bg-slate-50 p-3 rounded-lg flex gap-4 items-start border border-slate-100">
                          <div className="bg-white px-2 py-1 rounded shadow-sm text-xs font-bold text-slate-700 flex items-center shrink-0 border border-slate-200">
                            <Clock className="h-3.5 w-3.5 mr-1 text-emerald-600" /> {meal.time}
                          </div>
                          <div>
                            <p className="font-semibold text-sm text-slate-900">{meal.name}</p>
                            <p className="text-sm text-slate-600 mt-1">{Array.isArray(meal.items) ? meal.items.join(', ') : meal.items}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                  <Button variant="outline" className="w-full mt-4 text-slate-700" onClick={handleDiscardPlan}>
                    Substituir Plano Alimentar
                  </Button>
                </div>
              )}

              {planStatus === 'draft' && draftPlan && (
                <div className="space-y-6">
                  <div className="bg-amber-50 border border-amber-200 p-4 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                      <h4 className="font-medium text-amber-900">Rascunho do Plano Gerado</h4>
                      <p className="text-sm text-amber-700">Apenas o nutricionista vê este rascunho. Clique em aprovar para disponibilizar ao paciente.</p>
                    </div>
                    <Button onClick={handleApprovePlan} className="bg-amber-600 hover:bg-amber-700 text-white border-0 flex-shrink-0">
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Aprovar e Liberar
                    </Button>
                  </div>

                  {draftPlan.days?.map((day: any, idx: number) => (
                    <div key={idx} className="space-y-4">
                      <h4 className="font-bold text-slate-800 border-b pb-2">{day.name}</h4>
                      {day.meals?.map((meal: any, mIdx: number) => (
                        <div key={mIdx} className="bg-slate-50 p-3 rounded-lg flex gap-4 items-start border border-slate-100">
                          <div className="bg-white px-2 py-1 rounded shadow-sm text-xs font-bold text-slate-700 flex items-center shrink-0 border border-slate-200">
                            <Clock className="h-3.5 w-3.5 mr-1 text-amber-600" /> {meal.time}
                          </div>
                          <div>
                            <p className="font-semibold text-sm text-slate-900">{meal.name}</p>
                            <p className="text-sm text-slate-600 mt-1">{Array.isArray(meal.items) ? meal.items.join(', ') : meal.items}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                  <Button variant="outline" className="w-full text-red-600 hover:text-red-700 hover:bg-red-50" onClick={handleDiscardPlan}>
                    Descartar Rascunho
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
