'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { Card, CardContent, CardHeader, CardTitle, Button, Input } from '@/components/ui';
import { Leaf } from 'lucide-react';
import Link from 'next/link';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { role, login } = useAuth();
  const router = useRouter();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    // Mock authentication check based on email keyword just for testing
    if (email.includes('ana')) {
      login('nutritionist');
    } else {
      login('patient');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-transparent px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md space-y-8 z-10 relative">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 bg-teal-600 rounded-xl flex items-center justify-center shadow-lg">
            <Leaf className="h-6 w-6 text-white" />
          </div>
          <h2 className="mt-6 text-3xl font-bold tracking-tight text-slate-800">
            Entrar no NutriConnect
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Dica: email contendo &apos;ana&apos; entra como Nutricionista.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <form className="space-y-6" onSubmit={handleLogin}>
              <Input
                id="email"
                type="email"
                label="Email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
              />
              <Input
                id="password"
                type="password"
                label="Senha"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
              <Button type="submit" className="w-full">
                Entrar
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-slate-600">
          Ainda não tem uma conta?{' '}
          <Link href="/register" className="font-bold text-teal-700 hover:text-teal-800">
            Cadastre-se
          </Link>
        </p>
      </div>
    </div>
  );
}
