import { MOCK_PATIENT } from '@/lib/mock-data';
import { Card, CardContent, CardHeader, CardTitle, Badge } from '@/components/ui';
import { Clock } from 'lucide-react';

export default function PatientPlan() {
  const plan = MOCK_PATIENT.currentPlan;

  if (!plan || plan.status !== 'approved') {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-medium text-gray-900">Nenhum plano ativo</h2>
        <p className="text-gray-600 mt-2">Seu nutricionista ainda não liberou seu plano alimentar.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Meu Plano Alimentar</h1>
        <p className="text-gray-600">Siga as orientações para atingir seus objetivos.</p>
      </div>

      <div className="space-y-8">
        {plan.days.map((day, idx) => (
          <div key={idx} className="space-y-4">
            <h2 className="text-xl font-semibold text-gray-800 border-b pb-2">{day.name}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {day.meals.map((meal, mealIdx) => (
                <Card key={mealIdx} className="hover:border-emerald-200 transition-colors">
                  <CardHeader className="pb-3 border-b-0">
                    <div className="flex justify-between items-center">
                      <CardTitle className="text-base">{meal.name}</CardTitle>
                      <Badge variant="default">
                        <span className="flex items-center text-xs">
                          <Clock className="w-3 h-3 mr-1" />
                          {meal.time}
                        </span>
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <ul className="space-y-2 mt-2">
                      {meal.items.map((item, itemIdx) => (
                        <li key={itemIdx} className="flex items-start text-sm text-gray-700">
                          <span className="mr-2 text-emerald-500">•</span>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
