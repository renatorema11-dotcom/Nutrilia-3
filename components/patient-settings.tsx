'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Button, Input } from '@/components/ui';
import { Save, AlertCircle } from 'lucide-react';

export function PatientSettings({ 
  patientData, 
  onSave 
}: { 
  patientData: any; 
  onSave: (newData: any) => void;
}) {
  const [formData, setFormData] = useState({
    name: '',
    age: '',
    height: '',
    weight: '',
    objective: ''
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (patientData) {
      setFormData({
        name: patientData.name || '',
        age: patientData.age || '',
        height: patientData.height || '',
        weight: patientData.weight || '',
        objective: patientData.objective || ''
      });
    }
  }, [patientData]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
    if (errors[id]) {
      setErrors(prev => ({ ...prev, [id]: '' }));
    }
    setSuccessMsg('');
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    const age = parseInt(formData.age);
    const weight = parseFloat(formData.weight);
    const height = parseInt(formData.height);

    if (isNaN(age) || age < 1 || age > 120) {
      newErrors.age = 'A idade deve estar entre 1 e 120 anos.';
    }
    if (isNaN(height) || height < 50 || height > 300) {
      newErrors.height = 'A altura deve estar entre 50 e 300 cm.';
    }
    if (isNaN(weight) || weight < 10 || weight > 500) {
      newErrors.weight = 'O peso deve estar entre 10 e 500 kg.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    
    // Save patient data
    localStorage.setItem('mockPatientData', JSON.stringify(formData));
    
    // Update the history last value
    const savedHistory = localStorage.getItem('mockPatientHistory');
    if (savedHistory) {
      try {
        const history = JSON.parse(savedHistory);
        if (history.length > 0) {
          // Update the last recorded weight (current month)
          history[history.length - 1].weight = parseFloat(formData.weight);
          localStorage.setItem('mockPatientHistory', JSON.stringify(history));
        }
      } catch (err) {}
    }

    setSuccessMsg('Dados atualizados com sucesso!');
    onSave(formData);
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Configurações do Perfil</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            id="name"
            label="Nome Completo"
            required
            value={formData.name}
            onChange={handleChange}
          />
          
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Input
                id="age"
                type="number"
                label="Idade"
                required
                value={formData.age}
                onChange={handleChange}
              />
              {errors.age && <p className="text-xs text-red-500 font-medium">{errors.age}</p>}
            </div>
            <div className="space-y-1">
              <Input
                id="height"
                type="number"
                label="Altura (cm)"
                required
                value={formData.height}
                onChange={handleChange}
              />
              {errors.height && <p className="text-xs text-red-500 font-medium">{errors.height}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Input
                id="weight"
                type="number"
                label="Peso (kg)"
                required
                value={formData.weight}
                onChange={handleChange}
                placeholder="Última medição"
              />
              {errors.weight && <p className="text-xs text-red-500 font-medium">{errors.weight}</p>}
            </div>
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
                <option value="Emagrecimento">Emagrecimento</option>
                <option value="Hipertrofia">Hipertrofia (Ganho de Massa)</option>
                <option value="Manutenção">Manutenção</option>
                <option value="Saúde e Bem-estar">Saúde e Bem-estar</option>
              </select>
            </div>
          </div>

          {successMsg && (
            <div className="p-3 bg-teal-50 text-teal-700 border border-teal-200 rounded-lg text-sm flex items-center">
              <AlertCircle className="w-4 h-4 mr-2" />
              {successMsg}
            </div>
          )}

          <Button type="submit" className="w-full flex items-center justify-center gap-2">
            <Save className="h-4 w-4" />
            Salvar Alterações
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
