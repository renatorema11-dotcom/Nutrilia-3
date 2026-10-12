'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { Lightbulb, Loader2 } from 'lucide-react';
import Markdown from 'react-markdown';
import { ApiError, postJson } from '@/lib/api-client';

export function DailyNutritionTip({ objective }: { objective: string }) {
  const [tip, setTip] = useState('');
  const [failure, setFailure] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchTip = async () => {
      // Check if we already have a tip for today in session storage
      const today = new Date().toDateString();
      const cached = sessionStorage.getItem(`daily_tip_${today}`);
      if (cached) {
        setTip(cached);
        setIsLoading(false);
        return;
      }

      try {
        const data = await postJson('/api/gemini/generate-daily-tip', { objective });
        if (data.text) {
          setTip(data.text);
          sessionStorage.setItem(`daily_tip_${today}`, data.text);
        }
      } catch (error) {
        console.error(error);
        // Sem dica pronta no lugar: se a IA não respondeu, a tela diz isso.
        setFailure(error instanceof ApiError ? error.message : 'Não foi possível gerar a dica de hoje.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchTip();
  }, [objective]);

  return (
    <Card className="bg-amber-50/80 border-amber-200 h-full flex flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center text-amber-800 text-sm font-bold uppercase tracking-wide">
          <Lightbulb className="w-4 h-4 mr-2 text-amber-500" />
          Dica do Dia
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-amber-600/80 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            Curando dica para {objective}...
          </div>
        ) : !tip ? (
          <p role="status" className="text-amber-800/80 text-sm">
            Sem dica por enquanto. {failure || 'Volte mais tarde.'}
          </p>
        ) : (
          <div className="text-amber-900 text-sm font-medium leading-relaxed markdown-body">
             <Markdown>{tip}</Markdown>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
