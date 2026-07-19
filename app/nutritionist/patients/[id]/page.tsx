'use client';

import { useState, use } from 'react';
import { MOCK_PATIENTS_LIST } from '@/lib/mock-data';
import { Card, CardContent, CardHeader, CardTitle, Badge, Button, Input } from '@/components/ui';
import { ArrowLeft, Clock, Wand2, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';

export default function PatientProfile({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const patient = MOCK_PATIENTS_LIST.find(p => p.id === resolvedParams.id);
  const [generating, setGenerating] = useState(false);
  const [instructions, setInstructions] = useState('');
  const [draftPlan, setDraftPlan] = useState<any>(patient?.currentPlan?.status === 'draft' ? patient.currentPlan : null);
  const [planStatus, setPlanStatus] = useState<'none' | 'draft' | 'approved'>(
    patient?.currentPlan?.status === 'approved' ? 'approved' : 
    patient?.currentPlan?.status === 'draft' ? 'draft' : 'none'
  );

  if (!patient) return <div>Paciente não encontrado</div>;

  const handleGeneratePlan = async () => {
    setGenerating(true);
    try {
      const res = await fetch('/api/gemini/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patientContext: JSON.stringify({
            idade: patient.age,
            medidas: patient.measurements[patient.measurements.length - 1] || {},
          }),
          instructions
        })
      });
      const json = await res.json();
      if (json.data) {
        setDraftPlan({ days: json.data.days, status: 'draft', id: 'new_draft' });
        setPlanStatus('draft');
      }
    } catch (e) {
      console.error(e);
      alert('Erro ao gerar plano.');
    } finally {
      setGenerating(false);
    }
  };

  const handleApprovePlan = () => {
    setPlanStatus('approved');
    alert('Plano aprovado e liberado para o paciente!');
  };

  return (
    <div className="space-y-6">
      <div>
        <Link href="/nutritionist/patients" className="inline-flex items-center text-sm font-medium text-emerald-600 hover:text-emerald-700 mb-4">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Voltar para Pacientes
        </Link>
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{patient.name}</h1>
            <p className="text-gray-600">{patient.email} • {patient.age} anos</p>
          </div>
          {planStatus === 'approved' && <Badge variant="success">Plano Ativo</Badge>}
          {planStatus === 'draft' && <Badge variant="warning">Rascunho Pendente</Badge>}
          {planStatus === 'none' && <Badge variant="default">Sem Plano</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Últimas Medidas</CardTitle>
            </CardHeader>
            <CardContent>
              {patient.measurements.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex justify-between border-b pb-2">
                    <span className="text-gray-600">Peso</span>
                    <span className="font-medium">{patient.measurements[patient.measurements.length - 1].weight} kg</span>
                  </div>
                  <div className="flex justify-between border-b pb-2">
                    <span className="text-gray-600">% Gordura</span>
                    <span className="font-medium">{patient.measurements[patient.measurements.length - 1].bodyFat}%</span>
                  </div>
                  <div className="flex justify-between pb-2">
                    <span className="text-gray-600">Altura</span>
                    <span className="font-medium">{patient.measurements[patient.measurements.length - 1].height} cm</span>
                  </div>
                </div>
              ) : (
                <p className="text-gray-500 text-sm">Sem medidas cadastradas.</p>
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
                    Gerar Plano com IA
                  </h3>
                  <p className="text-sm text-emerald-700">O modelo do Gemini analisará os dados do paciente para criar um rascunho de plano alimentar.</p>
                  <Input 
                    id="inst"
                    placeholder="Instruções (ex: Dieta low carb, sem lactose...)" 
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                  />
                  <Button onClick={handleGeneratePlan} disabled={generating} className="w-full">
                    {generating ? 'Gerando rascunho...' : 'Gerar Rascunho Inicial'}
                  </Button>
                </div>
              )}

              {planStatus === 'approved' && patient.currentPlan && (
                <div className="space-y-6">
                  {(patient.currentPlan as any).days?.map((day: any, idx: number) => (
                    <div key={idx} className="space-y-4">
                      <h4 className="font-medium border-b pb-2">{day.name}</h4>
                      {day.meals.map((meal: any, mIdx: number) => (
                        <div key={mIdx} className="bg-gray-50 p-3 rounded-lg flex gap-4 items-start">
                          <div className="bg-white px-2 py-1 rounded shadow-sm text-xs font-bold text-gray-700 flex items-center shrink-0">
                            <Clock className="h-3 w-3 mr-1" /> {meal.time}
                          </div>
                          <div>
                            <p className="font-medium text-sm text-gray-900">{meal.name}</p>
                            <p className="text-sm text-gray-600 mt-1">{meal.items.join(', ')}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                  <Button variant="outline" className="w-full mt-4" onClick={() => setPlanStatus('none')}>Substituir Plano</Button>
                </div>
              )}

              {planStatus === 'draft' && draftPlan && (
                <div className="space-y-6">
                  <div className="bg-amber-50 border border-amber-200 p-4 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                      <h4 className="font-medium text-amber-900">Rascunho gerado por IA</h4>
                      <p className="text-sm text-amber-700">Este plano não está visível para o paciente até sua aprovação.</p>
                    </div>
                    <Button onClick={handleApprovePlan} className="bg-amber-600 hover:bg-amber-700 text-white border-0 flex-shrink-0">
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Aprovar e Liberar
                    </Button>
                  </div>
                  
                  {draftPlan.days.map((day: any, idx: number) => (
                    <div key={idx} className="space-y-4">
                      <h4 className="font-medium border-b pb-2">{day.name}</h4>
                      {day.meals.map((meal: any, mIdx: number) => (
                        <div key={mIdx} className="bg-gray-50 p-3 rounded-lg flex gap-4 items-start">
                          <div className="bg-white px-2 py-1 rounded shadow-sm text-xs font-bold text-gray-700 flex items-center shrink-0">
                            <Clock className="h-3 w-3 mr-1" /> {meal.time}
                          </div>
                          <div>
                            <p className="font-medium text-sm text-gray-900">{meal.name}</p>
                            <p className="text-sm text-gray-600 mt-1">{meal.items.join(', ')}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                  <Button variant="outline" className="w-full text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => setPlanStatus('none')}>
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
