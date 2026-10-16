'use client';

import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { Apple, Hourglass, Loader2, LogOut, XCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from './auth-provider';
import { db } from '@/lib/firebase';
import { ApiError, postJson } from '@/lib/api-client';
import { Card, CardContent, Button, Input } from '@/components/ui';
import { CRN_REGIONS, parseCrn } from '@/lib/crn';

interface PendingProfile { crn?: string; specialty?: string; phone?: string; role?: string; approval?: string }

/**
 * Tela da nutricionista enquanto o cadastro está em análise (ou foi recusado). Pede os dados profissionais que
 * faltarem, avisa o responsável pelo NutriAli e abre o painel sozinha assim que a aprovação chegar.
 */
export function NutritionistPending() {
  const { user, approval, logout } = useAuth();
  const [profile, setProfile] = useState<PendingProfile | null>(null);
  const [rejected, setRejected] = useState(approval === 'rejected');
  const [editing, setEditing] = useState(false);
  const [crnRegion, setCrnRegion] = useState('');
  const [crnNumber, setCrnNumber] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const requested = useRef(false);

  useEffect(() => {
    if (!user) return;
    // Listener necessário: quem aprova é outra pessoa, em outro aparelho; esta tela reage na hora.
    return onSnapshot(doc(db, 'users', user.uid), (snapshot) => {
      const data = (snapshot.data() || {}) as PendingProfile;
      if (data.role === 'nutritionist' && data.approval !== 'pending' && data.approval !== 'rejected') {
        // Aprovada: recarrega para o app inteiro enxergar a conta liberada e abrir o painel.
        window.location.assign('/nutritionist');
        return;
      }
      setRejected(data.approval === 'rejected');
      setProfile(data);
    }, () => setError('Não foi possível conferir a situação do cadastro. Recarregue a página.'));
  }, [user]);

  const complete = !!(profile?.crn && profile.specialty && profile.phone);

  useEffect(() => {
    // Cadastro completo: garante que o pedido foi registrado e o responsável, avisado (o servidor não repete o e-mail).
    if (!complete || rejected || requested.current) return;
    requested.current = true;
    postJson('/api/nutritionist/approval', {}).catch((requestError) => console.warn('Pedido de aprovação:', requestError));
  }, [complete, rejected]);

  const startEditing = () => {
    const current = parseCrn(profile?.crn);
    setCrnRegion(current.ok ? String(current.region) : '');
    setCrnNumber(current.ok ? current.number : '');
    setSpecialty(profile?.specialty || '');
    setPhone(profile?.phone || '');
    setError('');
    setEditing(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError('');
    const checked = parseCrn(`CRN-${crnRegion} ${crnNumber}`);
    if (!crnRegion || !checked.ok) {
      setError(!crnRegion ? 'Escolha a região do seu CRN.' : checked.ok ? '' : checked.error);
      return;
    }
    setSaving(true);
    try {
      await postJson('/api/nutritionist/approval', { crn: checked.crn, specialty: specialty.trim(), phone: phone.trim() });
      requested.current = true;
      setEditing(false);
    } catch (submitError) {
      setError(submitError instanceof ApiError ? submitError.message : 'Não foi possível enviar os dados agora. Tente de novo.');
    } finally {
      setSaving(false);
    }
  };

  const showForm = !rejected && profile !== null && (editing || !complete);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="mx-auto h-12 w-12 bg-[#4c8466] rounded-xl flex items-center justify-center shadow-lg">
            <Apple className="h-6 w-6 text-white" />
          </div>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-5">
            {profile === null && !error ? (
              <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 animate-spin text-teal-600" /></div>
            ) : rejected ? (
              <div className="text-center space-y-3">
                <XCircle className="w-12 h-12 text-red-500 mx-auto" />
                <h1 className="text-xl font-bold text-slate-800">Cadastro não aprovado</h1>
                <p className="text-sm text-slate-600">
                  Não conseguimos confirmar os dados profissionais deste cadastro. Se houve algum engano, responda ao
                  e-mail que enviamos para {user?.email || 'o seu endereço'} e revemos o seu cadastro.
                </p>
              </div>
            ) : showForm ? (
              <form className="space-y-4" onSubmit={handleSubmit}>
                <div>
                  <h1 className="text-xl font-bold text-slate-800">{complete ? 'Corrigir meus dados' : 'Falta pouco'}</h1>
                  <p className="mt-1 text-sm text-slate-600">
                    Informe os seus dados profissionais. Conferimos o CRN antes de liberar a área de nutricionista.
                  </p>
                </div>
                <div className="space-y-1">
                  <label htmlFor="pending-crn-number" className="block text-sm font-medium text-slate-700">CRN</label>
                  <div className="flex gap-2">
                    <select
                      aria-label="Região do CRN"
                      required
                      value={crnRegion}
                      onChange={(e) => setCrnRegion(e.target.value)}
                      className="w-32 shrink-0 rounded-lg bg-white/80 border border-white/50 px-3 py-2 text-slate-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 shadow-sm"
                    >
                      <option value="">Região</option>
                      {CRN_REGIONS.map((region) => <option key={region} value={region}>CRN-{region}</option>)}
                    </select>
                    <Input id="pending-crn-number" required value={crnNumber} onChange={(e) => setCrnNumber(e.target.value)} placeholder="Número da inscrição" maxLength={12} className="flex-1" />
                  </div>
                </div>
                <Input id="pending-specialty" label="Especialidade Principal" required value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder="Ex: Nutrição Esportiva" maxLength={120} />
                <Input id="pending-phone" label="Telefone de Contato" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(00) 00000-0000" maxLength={40} />
                {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
                <Button type="submit" disabled={saving} className="w-full">{saving ? 'Enviando...' : 'Enviar para análise'}</Button>
                {complete && (
                  <button type="button" onClick={() => setEditing(false)} className="w-full text-center text-sm font-medium text-teal-700 hover:text-teal-800">
                    Cancelar
                  </button>
                )}
              </form>
            ) : (
              <div className="text-center space-y-3">
                <motion.div
                  className="mx-auto w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center"
                  animate={{ rotate: [0, 0, 180, 180], scale: [1, 1.06, 1.06, 1] }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <Hourglass className="w-8 h-8 text-amber-600" />
                </motion.div>
                <h1 className="text-xl font-bold text-slate-800">Cadastro em análise</h1>
                <p className="text-sm text-slate-600">
                  Recebemos o seu cadastro e estamos conferindo o seu registro profissional
                  {profile?.crn ? <> (<strong>{profile.crn}</strong>)</> : null}.
                </p>
                <p className="text-sm text-slate-600">
                  Você recebe um e-mail em <strong>{user?.email}</strong> quando for aprovado, e esta tela abre o seu painel sozinha.
                </p>
                {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
                <button type="button" onClick={startEditing} className="text-sm font-medium text-teal-700 hover:text-teal-800">
                  Corrigir meus dados
                </button>
              </div>
            )}

            <Button variant="outline" onClick={logout} className="w-full gap-2">
              <LogOut className="w-4 h-4" />
              Sair
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
