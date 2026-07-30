'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { Card, CardContent, Button, Input } from '@/components/ui';
import { Leaf } from 'lucide-react';
import Link from 'next/link';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const { login, loginWithGoogle } = useAuth();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.includes('ana')) {
      login('nutritionist');
    } else {
      login('patient');
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setIsLoadingGoogle(true);
      // Determine default role based on email if entered, or default to patient
      const preferredRole = email.includes('ana') ? 'nutritionist' : 'patient';
      await loginWithGoogle(preferredRole);
    } catch (error) {
      console.error('Google Sign-In Error:', error);
    } finally {
      setIsLoadingGoogle(false);
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
          <CardContent className="pt-6 space-y-6">
            <Button
              type="button"
              variant="outline"
              disabled={isLoadingGoogle}
              onClick={handleGoogleSignIn}
              className="w-full flex items-center justify-center gap-2 border-slate-200 bg-white hover:bg-slate-50 text-slate-700 h-11 font-medium shadow-sm"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              {isLoadingGoogle ? 'Entrando com Google...' : 'Entrar com o Google'}
            </Button>

            <div className="relative flex items-center justify-center">
              <div className="border-t border-slate-200 w-full" />
              <span className="bg-white px-3 text-xs text-slate-500 uppercase tracking-wider relative z-10">
                ou com email
              </span>
            </div>

            <form className="space-y-4" onSubmit={handleLogin}>
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
