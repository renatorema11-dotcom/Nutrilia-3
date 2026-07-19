'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, Button, Input } from '@/components/ui';
import { Activity, ArrowRight, User } from 'lucide-react';

export default function PatientOnboarding() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    name: '',
    age: '',
    weight: '',
    height: '',
    objective: ''
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('mockPatientData', JSON.stringify(formData));
    router.push('/patient');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-transparent px-4 py-12">
      <div className="w-full max-w-lg space-y-8 z-10 relative">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 bg-teal-600 rounded-xl flex items-center justify-center shadow-lg">
            <Activity className="h-6 w-6 text-white" />
          </div>
          <h2 className="mt-6 text-3xl font-bold tracking-tight text-slate-800">
            Bem-vindo(a)!
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Para personalizar sua experiência, precisamos de algumas informações sobre você.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                id="name"
                label="Qual é o seu nome?"
                required
                value={formData.name}
                onChange={handleChange}
                placeholder="Ex: João Silva"
              />
              
              <div className="grid grid-cols-2 gap-4">
                <Input
                  id="age"
                  type="number"
                  label="Idade"
                  required
                  value={formData.age}
                  onChange={handleChange}
                  placeholder="Ex: 30"
                />
                <Input
                  id="height"
                  type="number"
                  label="Altura (cm)"
                  required
                  value={formData.height}
                  onChange={handleChange}
                  placeholder="Ex: 175"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Input
                  id="weight"
                  type="number"
                  label="Peso (kg)"
                  required
                  value={formData.weight}
                  onChange={handleChange}
                  placeholder="Ex: 75.5"
                />
                <div className="space-y-1">
                  <label htmlFor="objective" className="block text-sm font-medium text-slate-700">
                    Objetivo Principal
                  </label>
                  <select
                    id="objective"
                    required
                    value={formData.objective}
                    onChange={handleChange}
                    className="w-full rounded-lg bg-white/80 border border-white/50 px-3 py-2 text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 shadow-sm transition-shadow h-[42px]"
                  >
                    <option value="" disabled>Selecione...</option>
                    <option value="Emagrecimento">Emagrecimento</option>
                    <option value="Hipertrofia">Hipertrofia (Ganho de Massa)</option>
                    <option value="Manutenção">Manutenção</option>
                    <option value="Saúde e Bem-estar">Saúde e Bem-estar</option>
                  </select>
                </div>
              </div>

              <Button type="submit" className="w-full mt-6 flex items-center justify-center gap-2">
                Concluir Triagem
                <ArrowRight className="h-4 w-4" />
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
