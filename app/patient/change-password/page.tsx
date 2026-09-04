'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged, signOut, updatePassword } from 'firebase/auth';
import { Lock, LogOut } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { updateUserData } from '@/lib/db';
import { auth } from '@/lib/firebase';

export default function ChangePasswordPage() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) setReady(true);
    });
    return () => unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 8) {
      setError('A nova senha deve ter pelo menos 8 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }

    setLoading(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Sessão expirada. Faça login novamente.');

      await updatePassword(user, newPassword);
      // Limpa a flag de troca obrigatória no perfil do usuário
      await updateUserData(user.uid, { mustChangePassword: false });
      router.push('/patient');
    } catch (err: any) {
      console.error('Password change failed:', err);
      if (err?.code === 'auth/requires-recent-login') {
        setError('Por segurança, faça login novamente antes de trocar a senha.');
        await signOut(auth);
        router.push('/login');
      } else {
        setError('Não foi possível alterar a senha. Tente novamente.');
      }
    } finally {
      setLoading(false);
    }
  };

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-500 text-sm">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 sm:px-6">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 bg-[#4c8466] rounded-xl flex items-center justify-center shadow-lg">
            <Lock className="h-6 w-6 text-white" />
          </div>
          <h2 className="mt-6 text-3xl font-bold tracking-tight text-slate-800">
            Crie sua nova senha
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Por segurança, você precisa definir sua própria senha no primeiro acesso.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Nova senha</label>
            <Input
              type="password"
              placeholder="Mínimo de 8 caracteres"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-700">Confirmar nova senha</label>
            <Input
              type="password"
              placeholder="Repita a nova senha"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          <Button
            type="submit"
            disabled={loading}
            className="w-full bg-[#4c8466] hover:bg-[#3d6a54] text-white"
          >
            {loading ? 'Salvando...' : 'Salvar nova senha'}
          </Button>

          <button
            type="button"
            onClick={async () => {
              await signOut(auth);
              router.push('/login');
            }}
            className="w-full flex items-center justify-center gap-2 text-xs text-slate-500 hover:text-slate-700 transition-colors"
          >
            <LogOut className="w-3 h-3" />
            Sair e voltar ao login
          </button>
        </form>
      </div>
    </div>
  );
}
