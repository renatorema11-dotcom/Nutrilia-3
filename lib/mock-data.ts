export const MOCK_PATIENT = {
  id: 'p1',
  name: 'João Silva',
  email: 'joao@example.com',
  age: 32,
  nextAppointment: '2026-08-15T10:00:00Z',
  measurements: [
    { date: '2026-04-10', weight: 85, bodyFat: 22, height: 180 },
    { date: '2026-05-15', weight: 83.5, bodyFat: 20.5, height: 180 },
    { date: '2026-06-20', weight: 82, bodyFat: 19, height: 180 },
    { date: '2026-07-18', weight: 80.5, bodyFat: 17.5, height: 180 }
  ],
  currentPlan: {
    id: 'plan1',
    status: 'approved',
    createdDate: '2026-06-20',
    days: [
      {
        name: 'Segunda a Sexta',
        meals: [
          { time: '08:00', name: 'Café da Manhã', items: ['2 Ovos mexidos', '1 Fatia de pão integral', 'Café preto'] },
          { time: '12:30', name: 'Almoço', items: ['150g Peito de frango', '100g Arroz integral', 'Salada à vontade'] },
          { time: '16:00', name: 'Lanche', items: ['1 Iogurte natural', '30g Aveia', '1 Maçã'] },
          { time: '20:00', name: 'Jantar', items: ['120g Patinho moído', '100g Batata doce', 'Brócolis'] }
        ]
      },
      {
        name: 'Fim de Semana',
        meals: [
          { time: '09:00', name: 'Café da Manhã', items: ['Panqueca de aveia (1 ovo, 30g aveia, 1 banana)', 'Café'] },
          { time: '13:30', name: 'Almoço', items: ['Livre (Refeição moderada)'] },
          { time: '17:00', name: 'Lanche', items: ['Whey Protein', 'Fruta'] },
          { time: '20:30', name: 'Jantar', items: ['Omelete de 3 ovos', 'Salada'] }
        ]
      }
    ]
  },
  pastPlans: [
    {
      id: 'plan0',
      status: 'approved',
      createdDate: '2026-04-10'
    }
  ]
};

export const MOCK_PATIENTS_LIST = [
  MOCK_PATIENT,
  {
    id: 'p2',
    name: 'Maria Souza',
    email: 'maria@example.com',
    age: 28,
    nextAppointment: '2026-07-20T14:00:00Z',
    measurements: [{ date: '2026-06-15', weight: 65, bodyFat: 25, height: 165 }],
    currentPlan: null, // Need to generate plan
    pastPlans: []
  },
  {
    id: 'p3',
    name: 'Carlos Oliveira',
    email: 'carlos@example.com',
    age: 45,
    nextAppointment: '2026-07-25T09:00:00Z',
    measurements: [{ date: '2026-05-10', weight: 95, bodyFat: 28, height: 175 }],
    currentPlan: { id: 'plan_p3', status: 'draft', createdDate: '2026-07-15' }, // Waiting approval
    pastPlans: []
  }
];

export const MOCK_NUTRITIONIST = {
  id: 'n1',
  name: 'Dra. Ana Costa',
  email: 'ana@nutriconnect.com',
  alerts: [
    { id: 1, type: 'action', message: 'Rascunho de plano para Carlos Oliveira pendente de aprovação.' },
    { id: 2, type: 'warning', message: 'Maria Souza enviou uma dúvida no chat.' },
    { id: 3, type: 'info', message: 'Consulta com Maria Souza amanhã às 14h.' }
  ]
};
