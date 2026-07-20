'use client';

import { useEffect, useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from '@/components/ui';
import { Calendar, Download, FileText } from 'lucide-react';
import Markdown from 'react-markdown';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useReactToPrint } from 'react-to-print';

function PlanCard({ plan }: { plan: any }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({
    contentRef,
    documentTitle: 'Meu Plano Alimentar',
  });

  return (
    <Card className="border-teal-100">
      <CardHeader className="bg-teal-50/50 border-b border-teal-100 pb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-teal-600" />
          <CardTitle className="text-lg text-teal-900">
            Plano Criativo ({plan.objective || 'Geral'})
          </CardTitle>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="default" className="bg-white/80">
            <Calendar className="w-3 h-3 mr-1" />
            {format(parseISO(plan.date), "dd 'de' MMM, yyyy", { locale: ptBR })}
          </Badge>
          <Button 
            variant="outline" 
            className="h-8 text-xs bg-white text-teal-700 hover:text-teal-800"
            onClick={() => handlePrint()}
          >
            <Download className="w-3 h-3 mr-1" /> Exportar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        <div 
          ref={contentRef} 
          className="markdown-body text-sm text-slate-800 p-2"
        >
          <Markdown>{plan.content}</Markdown>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PatientPlan() {
  const [savedPlans, setSavedPlans] = useState<any[]>([]);

  useEffect(() => {
    const plansStr = localStorage.getItem('mockSavedPlans');
    if (plansStr) {
      try {
        setSavedPlans(JSON.parse(plansStr));
      } catch (e) {
        console.error(e);
      }
    }
  }, []);

  if (savedPlans.length === 0) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-medium text-slate-900">Nenhum plano ativo</h2>
        <p className="text-slate-600 mt-2">Você ainda não salvou nenhum plano alimentar criativo.</p>
        <p className="text-slate-600">Volte ao Dashboard para gerar um novo plano!</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Meus Planos Alimentares</h1>
        <p className="text-slate-600">Seus planos criativos salvos.</p>
      </div>

      <div className="space-y-8">
        {savedPlans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} />
        ))}
      </div>
    </div>
  );
}
