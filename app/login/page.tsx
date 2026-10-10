'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { Card, CardContent, Button, Input } from '@/components/ui';
import { Apple } from 'lucide-react';
import Link from 'next/link';
import { LanguageSelector } from '@/components/language-selector';

function loginErrorMessage(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error
    && typeof error.code === 'string' ? error.code : '';
  switch (code) {
    case 'auth/unauthorized-domain':
      return 'Este endereço ainda não está autorizado para entrar com Google. Contate o responsável pelo aplicativo. (auth/unauthorized-domain)';
    case 'auth/popup-blocked':
      return 'O navegador bloqueou a janela do Google. Permita pop-ups para este aplicativo e tente novamente. (auth/popup-blocked)';
    case 'auth/popup-closed-by-user':
      return 'A janela do Google foi fechada antes de concluir o login. Tente novamente. Se ela fechar sozinha, abra este mesmo endereço no Chrome e tente por lá. (auth/popup-closed-by-user)';
    case 'auth/cancelled-popup-request':
      return 'Outra tentativa de login estava aberta. Feche as janelas de login e tente uma vez novamente.';
    case 'auth/operation-not-allowed':
      return 'Esta forma de login não está habilitada no aplicativo. Contate o responsável. (auth/operation-not-allowed)';
    case 'auth/network-request-failed':
    case 'unavailable':
      return 'Não foi possível conectar ao serviço de login ou carregar seu perfil. Confira a conexão e tente novamente.';
    case 'permission-denied':
      return 'Sua conta foi autenticada, mas o aplicativo não conseguiu acessar seu perfil. O responsável precisa verificar as permissões do perfil. (permission-denied)';
    case 'auth/account-exists-with-different-credential':
      return 'Esta conta já usa outra forma de entrada. Entre pelo método usado no cadastro.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'Não foi possível entrar com esses dados. Confira o email e a senha.';
    case 'auth/too-many-requests':
      return 'Houve muitas tentativas. Aguarde um pouco antes de tentar novamente.';
    case 'auth/user-disabled':
      return 'Esta conta está desativada. Contate o responsável pelo aplicativo.';
    default:
      return 'Não foi possível concluir o login. Tente novamente ou contate o responsável pelo aplicativo.'
        + (/^(auth\/[a-z-]+|[a-z-]+)$/.test(code) ? ` (${code})` : '');
  }
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingGoogle, setIsLoadingGoogle] = useState(false);
  const [loginError, setLoginError] = useState('');
  const { loginWithGoogle, loginWithEmail, user, role, ready, mustChangePassword } = useAuth();
  const router = useRouter();
  const sessionChecked = useRef(false);

  // Quem abre o app já conectado (ex.: pelo ícone na tela inicial) vai direto ao painel.
  // Confere só uma vez, para não disputar com o redirecionamento do próprio login.
  useEffect(() => {
    if (!ready || sessionChecked.current) return;
    sessionChecked.current = true;
    if (user && role) {
      router.replace(role === 'patient' && mustChangePassword ? '/patient/change-password' : `/${role}`);
    }
  }, [ready, user, role, mustChangePassword, router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading || isLoadingGoogle) return;
    setLoginError('');
    setIsLoading(true);
    
    try {
      await loginWithEmail(email, password);
    } catch (error) {
      setLoginError(loginErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (isLoading || isLoadingGoogle) return;
    setLoginError('');
    try {
      setIsLoadingGoogle(true);
      // Novos usuários Google entram como paciente; nutricionistas se cadastram
      // pela tela de registro com seletor de perfil. Usuários existentes recebem
      // o papel salvo no próprio documento.
      await loginWithGoogle('patient');
    } catch (error) {
      setLoginError(loginErrorMessage(error));
    } finally {
      setIsLoadingGoogle(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-transparent px-4 sm:px-6 lg:px-8 relative">
      <div className="absolute top-4 right-4 z-50">
        <LanguageSelector />
      </div>
      <div className="w-full max-w-md space-y-8 z-10 relative">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 bg-[#4c8466] rounded-xl flex items-center justify-center shadow-lg">
            <Apple className="h-6 w-6 text-white" />
          </div>
          <h2 className="mt-6 text-3xl font-bold tracking-tight text-slate-800">
            Entrar no NutriAli
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Acesse sua conta para continuar sua jornada de saúde.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-6">
            {loginError && (
              <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {loginError}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={isLoadingGoogle || isLoading}
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

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-slate-200" />
              <span className="text-xs text-slate-500 uppercase tracking-wider whitespace-nowrap">
                ou com email
              </span>
              <div className="h-px flex-1 bg-slate-200" />
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
              <Button type="submit" disabled={isLoading || isLoadingGoogle} className="w-full">
                {isLoading ? 'Entrando...' : 'Entrar'}
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
