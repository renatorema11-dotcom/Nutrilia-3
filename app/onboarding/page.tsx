'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, Button, Input } from '@/components/ui';
import { Activity, ArrowRight, User } from 'lucide-react';
import { motion, Variants } from 'motion/react';

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 15 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
};

export default function PatientOnboarding() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    name: '',
    age: '',
    weight: '',
    height: '',
    objective: ''
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { id, value } = e.target;
    setFormData(prev => ({ ...prev, [id]: value }));
    // Limpar o erro quando o usuário digita
    if (errors[id]) {
      setErrors(prev => ({ ...prev, [id]: '' }));
    }
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
            <form onSubmit={handleSubmit}>
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="show"
                className="space-y-4"
              >
                <motion.div variants={itemVariants}>
                  <Input
                    id="name"
                    label="Qual é o seu nome?"
                    required
                    value={formData.name}
                    onChange={handleChange}
                    placeholder="Ex: João Silva"
                  />
                </motion.div>
                
                <div className="grid grid-cols-2 gap-4">
                  <motion.div variants={itemVariants} className="space-y-1">
                    <Input
                      id="age"
                      type="number"
                      label="Idade"
                      required
                      value={formData.age}
                      onChange={handleChange}
                      placeholder="Ex: 30"
                    />
                    {errors.age && <p className="text-xs text-red-500 font-medium">{errors.age}</p>}
                  </motion.div>
                  <motion.div variants={itemVariants} className="space-y-1">
                    <Input
                      id="height"
                      type="number"
                      label="Altura (cm)"
                      required
                      value={formData.height}
                      onChange={handleChange}
                      placeholder="Ex: 175"
                    />
                    {errors.height && <p className="text-xs text-red-500 font-medium">{errors.height}</p>}
                  </motion.div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <motion.div variants={itemVariants} className="space-y-1">
                    <Input
                      id="weight"
                      type="number"
                      label="Peso (kg)"
                      required
                      value={formData.weight}
                      onChange={handleChange}
                      placeholder="Ex: 75.5"
                    />
                    {errors.weight && <p className="text-xs text-red-500 font-medium">{errors.weight}</p>}
                  </motion.div>
                  <motion.div variants={itemVariants} className="space-y-1">
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
                  </motion.div>
                </div>

                <motion.div variants={itemVariants}>
                  <Button type="submit" className="w-full mt-6 flex items-center justify-center gap-2">
                    Concluir Triagem
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </motion.div>
              </motion.div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
