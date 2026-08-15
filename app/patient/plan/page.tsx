'use client';

import { useEffect, useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from '@/components/ui';
import { Calendar, Download, FileText } from 'lucide-react';
import Markdown from 'react-markdown';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { handlePrintOrDownload } from '@/lib/print-utils';
import { useAuth } from '@/components/auth-provider';
import { getUserData } from '@/lib/db';

function PlanCard({ plan }: { plan: any }) {
  const contentRef = useRef<HTMLDivElement>(null);

  const onExport = () => {
    handlePrintOrDownload(contentRef.current, 'Meu Plano Alimentar', plan.content);
  };

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
            onClick={onExport}
          >
            <Download className="w-3 h-3 mr-1" /> Exportar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        <div 
          ref={contentRef} 
          className="prose prose-teal max-w-none prose-sm sm:prose-base prose-headings:font-bold prose-h1:text-teal-900 prose-h1:text-2xl prose-h1:border-b prose-h1:pb-2 prose-h2:text-teal-800 prose-h2:text-xl prose-h3:text-teal-700 prose-h4:text-teal-600 prose-p:text-slate-700 prose-li:text-slate-700 prose-strong:text-teal-900 prose-ul:list-disc prose-ul:pl-5 prose-ol:list-decimal prose-ol:pl-5 bg-white rounded-xl shadow-sm border border-slate-100 p-6 sm:p-8"
        >
          <Markdown>{plan.content}</Markdown>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PatientPlan() {
  const [savedPlans, setSavedPlans] = useState<any[]>([]);
  const [isMounted, setIsMounted] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsMounted(true);

    const isValidPlanFormat = (data: any) => {
      try {
        const parsed = typeof data === 'string' ? JSON.parse(data) : data;
        if (!Array.isArray(parsed)) return false;
        return parsed.every(plan => plan && typeof plan === 'object' && 'id' in plan);
      } catch {
        return false;
      }
    };

    async function loadData() {
      if (user) {
        const data = await getUserData(user.uid);
        if (data?.savedPlans && isValidPlanFormat(data.savedPlans)) {
          setSavedPlans(data.savedPlans);
        }
      } else {
        const plansStr = localStorage.getItem('mockSavedPlans');
        if (plansStr) {
          if (isValidPlanFormat(plansStr)) {
            setSavedPlans(JSON.parse(plansStr));
          } else {
            console.error('Invalid saved plans format in localStorage');
          }
        }
      }
    }
    loadData();
  }, [user]);

  if (!isMounted) {
    return null; // Or a loading spinner
  }

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
