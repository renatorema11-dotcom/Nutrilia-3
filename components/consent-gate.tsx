'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { getUserData, updateUserData } from '@/lib/db';
import { hasCurrentConsent, newConsent, PRIVACY_CONTACT } from '@/lib/privacy';
import { Button } from '@/components/ui';

/**
 * Termo de privacidade para quem ainda não aceitou a versão em vigor (contas antigas, entrada pelo Google
 * ou política nova). Cobre a tela até a pessoa aceitar; dá para ler a política inteira e sair.
 */
export function ConsentGate({ uid, role, onLogout }: { uid: string; role: 'patient' | 'nutritionist'; onLogout: () => void }) {
  const [needed, setNeeded] = useState(false);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    // Se a leitura falhar, o app segue: o termo aparece de novo no próximo acesso.
    getUserData(uid)
      .then((profile) => { if (active) setNeeded(!hasCurrentConsent(profile)); })
      .catch(() => {});
    return () => { active = false; };
  }, [uid]);

  if (!needed) return null;

  const accept = async () => {
    if (!checked || saving) return;
    setSaving(true);
    setError('');
    try {
      await updateUserData(uid, { privacyConsent: newConsent() });
      setNeeded(false);
    } catch {
      setError('Não foi possível registrar o seu aceite agora. Tente de novo em instantes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="consent-title" className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl space-y-4">
        <div className="flex items-center gap-2 text-teal-700">
          <ShieldCheck className="h-5 w-5" />
          <h2 id="consent-title" className="text-lg font-bold text-slate-900">Privacidade dos seus dados</h2>
        </div>
        <p className="text-sm text-slate-700">
          {role === 'patient'
            ? 'O NutriAli guarda dados de saúde, como peso, refeições e conversas com a sua nutricionista, para o seu acompanhamento nutricional. Antes de continuar, precisamos do seu aceite.'
            : 'O NutriAli guarda dados de saúde dos seus pacientes, como peso, refeições e conversas, para o acompanhamento nutricional. Antes de continuar, precisamos do seu aceite.'}
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>Os dados são usados só para o acompanhamento nutricional, para a Ali e para lembretes e avisos.</li>
          <li>Não vendemos os seus dados e não os usamos para publicidade.</li>
          <li>Você pode baixar os seus dados ou pedir a exclusão da conta em Meu Perfil, ou escrever para {PRIVACY_CONTACT}.</li>
        </ul>
        <a href="/privacidade" target="_blank" rel="noopener noreferrer" className="inline-block text-sm font-semibold text-teal-700 underline">
          Ler a Política de Privacidade completa
        </a>
        <label className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-1 h-4 w-4 accent-teal-600" />
          <span>
            {role === 'patient'
              ? 'Li e aceito a Política de Privacidade e autorizo o uso dos meus dados, inclusive os de saúde, para o meu acompanhamento nutricional.'
              : 'Li e aceito a Política de Privacidade e me comprometo a usar os dados dos meus pacientes só para o acompanhamento nutricional, com sigilo profissional.'}
          </span>
        </label>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onLogout} className="border-slate-300 text-sm">Sair</Button>
          <Button onClick={accept} disabled={!checked || saving} className="gap-2 text-sm">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Aceitar e continuar
          </Button>
        </div>
      </div>
    </div>
  );
}
