'use client';

import { useState } from 'react';
import { Button, Input } from '@/components/ui';
import { X, UserPlus, Loader2 } from 'lucide-react';
import { createPatient, Patient } from '@/lib/patients';

interface AddPatientModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPatientAdded: (patient: Patient) => void;
}

export function AddPatientModal({ isOpen, onClose, onPatientAdded }: AddPatientModalProps) {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    age: '',
    weight: '',
    height: '',
    targetWeight: '',
    bodyFat: '',
    objective: 'Emagrecimento'
  });
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!formData.name.trim()) {
      setError('Por favor, informe o nome do paciente.');
      return;
    }
    if (!formData.email.trim()) {
      setError('Por favor, informe o e-mail.');
      return;
    }
    if (!formData.age || Number(formData.age) <= 0) {
      setError('Por favor, informe uma idade válida.');
      return;
    }
    if (!formData.weight || Number(formData.weight) <= 0) {
      setError('Por favor, informe o peso atual em kg.');
      return;
    }
    if (!formData.height || Number(formData.height) <= 0) {
      setError('Por favor, informe a altura em cm.');
      return;
    }

    setLoading(true);
    try {
      const newPatient = await createPatient({
        name: formData.name.trim(),
        email: formData.email.trim(),
        age: Number(formData.age),
        weight: Number(formData.weight),
        height: Number(formData.height),
        targetWeight: formData.targetWeight ? Number(formData.targetWeight) : undefined,
        bodyFat: formData.bodyFat ? Number(formData.bodyFat) : undefined,
        objective: formData.objective
      });

      onPatientAdded(newPatient);
      setFormData({
        name: '',
        email: '',
        age: '',
        weight: '',
        height: '',
        targetWeight: '',
        bodyFat: '',
        objective: 'Emagrecimento'
      });
      onClose();
    } catch (err: any) {
      console.error('Erro ao adicionar paciente:', err);
      setError('Ocorreu um erro ao cadastrar o paciente. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden border border-slate-100 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-700">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Novo Paciente</h2>
              <p className="text-xs text-slate-500">Cadastre um paciente real no seu consultório</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
            type="button"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Nome Completo *</label>
            <Input
              placeholder="Ex: Maria Rodrigues"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">E-mail *</label>
              <Input
                type="email"
                placeholder="paciente@exemplo.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
              />
              <p className="text-[10px] text-slate-500 mt-0.5">
                Será criada uma conta de login no Firebase com a senha inicial: <strong className="text-emerald-700">Mudar@123</strong>
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Idade (anos) *</label>
              <Input
                type="number"
                placeholder="Ex: 30"
                min="1"
                max="120"
                value={formData.age}
                onChange={(e) => setFormData({ ...formData, age: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Peso Atual (kg) *</label>
              <Input
                type="number"
                step="0.1"
                placeholder="Ex: 72.5"
                value={formData.weight}
                onChange={(e) => setFormData({ ...formData, weight: e.target.value })}
                required
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Altura (cm) *</label>
              <Input
                type="number"
                placeholder="Ex: 168"
                value={formData.height}
                onChange={(e) => setFormData({ ...formData, height: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">Meta de Peso (kg)</label>
              <Input
                type="number"
                step="0.1"
                placeholder="Ex: 65.0 (Opcional)"
                value={formData.targetWeight}
                onChange={(e) => setFormData({ ...formData, targetWeight: e.target.value })}
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-700">% Gordura Inicial</label>
              <Input
                type="number"
                step="0.1"
                placeholder="Ex: 22.0 (Opcional)"
                value={formData.bodyFat}
                onChange={(e) => setFormData({ ...formData, bodyFat: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Objetivo Principal *</label>
            <select
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              value={formData.objective}
              onChange={(e) => setFormData({ ...formData, objective: e.target.value })}
            >
              <option value="Emagrecimento">Emagrecimento</option>
              <option value="Ganho de Massa Muscular">Ganho de Massa Muscular</option>
              <option value="Reeducação Alimentar">Reeducação Alimentar</option>
              <option value="Performance Esportiva">Performance Esportiva</option>
              <option value="Saúde e Bem Estar">Saúde e Bem Estar</option>
            </select>
          </div>

          {/* Footer */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading} className="bg-emerald-600 hover:bg-emerald-700 text-white min-w-[120px]">
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Salvando...
                </>
              ) : (
                'Cadastrar Paciente'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
