'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, UserRole } from '@/components/auth-provider';
import { Card, CardContent, Button, Input } from '@/components/ui';
import { Leaf, User, Stethoscope } from 'lucide-react';
import Link from 'next/link';

export default function Register() {
  const [role, setRole] = useState<UserRole>('patient');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [crn, setCrn] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [phone, setPhone] = useState('');
  const { role: authRole, login } = useAuth();
  const router = useRouter();

  const handleRegister = (e: React.FormEvent) => {
    e.preventDefault();
    // Simulate registration
    login(role, true);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-transparent px-4 sm:px-6 lg:px-8 py-12">
      <div className="w-full max-w-md space-y-8 z-10 relative">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 bg-teal-600 rounded-xl flex items-center justify-center shadow-lg">
            <Leaf className="h-6 w-6 text-white" />
          </div>
          <h2 className="mt-6 text-3xl font-bold tracking-tight text-slate-800">
            Criar sua conta
          </h2>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-6">
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setRole('patient')}
                className={`flex-1 py-4 flex flex-col items-center justify-center gap-2 rounded-xl border-2 transition-colors ${
                  role === 'patient' 
                    ? 'border-teal-500 bg-white/60 text-teal-700 shadow-sm' 
                    : 'border-white/50 bg-white/30 hover:border-teal-200 text-slate-600'
                }`}
              >
                <User className="h-6 w-6" />
                <span className="font-medium">Paciente</span>
              </button>
              <button
                type="button"
                onClick={() => setRole('nutritionist')}
                className={`flex-1 py-4 flex flex-col items-center justify-center gap-2 rounded-xl border-2 transition-colors ${
                  role === 'nutritionist' 
                    ? 'border-teal-500 bg-white/60 text-teal-700 shadow-sm' 
                    : 'border-white/50 bg-white/30 hover:border-teal-200 text-slate-600'
                }`}
              >
                <Stethoscope className="h-6 w-6" />
                <span className="font-medium">Nutricionista</span>
              </button>
            </div>

            <form className="space-y-4" onSubmit={handleRegister}>
              <Input
                id="name"
                label="Nome completo"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Input
                id="email"
                type="email"
                label="Email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <Input
                id="password"
                type="password"
                label="Senha"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              {role === 'nutritionist' && (
                <div className="space-y-4 pt-4 border-t border-white/20">
                  <h3 className="text-sm font-semibold text-slate-800">Informações Profissionais</h3>
                  <Input
                    id="crn"
                    label="CRN"
                    required
                    value={crn}
                    onChange={(e) => setCrn(e.target.value)}
                    placeholder="Ex: CRN-3 12345"
                  />
                  <Input
                    id="specialty"
                    label="Especialidade Principal"
                    required
                    value={specialty}
                    onChange={(e) => setSpecialty(e.target.value)}
                    placeholder="Ex: Nutrição Esportiva"
                  />
                  <Input
                    id="phone"
                    label="Telefone de Contato"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="(00) 00000-0000"
                  />
                </div>
              )}

              <Button type="submit" className="w-full mt-4">
                Criar conta
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-slate-600">
          Já tem uma conta?{' '}
          <Link href="/login" className="font-bold text-teal-700 hover:text-teal-800">
            Faça login
          </Link>
        </p>
      </div>
    </div>
  );
}
