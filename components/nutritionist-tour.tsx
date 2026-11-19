'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bot, Check, ChevronLeft, ChevronRight, LayoutDashboard, MessageSquare, MessageSquareText, Sparkles, User, Users, X, type LucideIcon } from 'lucide-react';
import { useAuth } from './auth-provider';
import { getUserData, updateUserData } from '@/lib/db';

interface TourStep {
  /** Endereço do item do menu que este passo mostra; sem ele, o passo é só o cartão. */
  href?: string;
  icon: LucideIcon;
  color: string;
  title: string;
  text: string;
}

const STEPS: TourStep[] = [
  { icon: Sparkles, color: 'bg-teal-600', title: 'Bem-vindo(a) ao NutriAli!', text: 'Um giro de meio minuto pela sua área. Dá para pular quando quiser.' },
  { href: '/nutritionist', icon: LayoutDashboard, color: 'bg-emerald-600', title: 'Dashboard', text: 'O resumo do consultório: consultas marcadas, pedidos da Ali e pacientes que esperam plano.' },
  { href: '/nutritionist/patients', icon: Users, color: 'bg-sky-600', title: 'Pacientes', text: 'Cadastre pacientes, abra o prontuário e monte o plano alimentar. A IA rascunha; você revisa e aprova.' },
  { href: '/nutritionist/chat', icon: MessageSquare, color: 'bg-violet-600', title: 'Chat com Pacientes', text: 'Converse direto com cada paciente, sem sair do app.' },
  { href: '/nutritionist/assistant', icon: MessageSquareText, color: 'bg-purple-600', title: 'Assistente IA', text: 'Tire dúvidas e peça ideias com base nos dados dos seus pacientes.' },
  { href: '/nutritionist/ali', icon: Bot, color: 'bg-amber-600', title: 'Minha Ali', text: 'Conecte a sua agenda e o seu Gmail: a Ali marca consultas, lembra o paciente e envia o plano por e-mail.' },
  { href: '/nutritionist/profile', icon: User, color: 'bg-rose-600', title: 'Meu Perfil', text: 'Foto, especialidade e apresentação: é o que o paciente vê ao escolher você. Bom trabalho!' },
];

/** Posição, na tela, do item do menu que está visível (barra lateral no computador, barra de baixo no celular). */
function menuItemRect(href: string): DOMRect | null {
  let found: DOMRect | null = null;
  // Fica com o último visível: no celular, o item da barra de baixo vem depois do logotipo do topo (que também leva ao início).
  for (const link of document.querySelectorAll<HTMLAnchorElement>(`a[href="${href}"]`)) {
    const rect = link.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight) found = rect;
  }
  return found;
}

/** Tour curto e animado da área da nutricionista: aparece uma vez, na primeira entrada depois da aprovação. */
export function NutritionistTour() {
  const { user } = useAuth();
  const [run, setRun] = useState(false);
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!user) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    getUserData(user.uid)
      .then((data) => {
        if (data && !data.hasSeenNutriTour) timer = setTimeout(() => setRun(true), 900);
      })
      .catch((error) => console.warn('Erro ao verificar o tour:', error));
    return () => clearTimeout(timer);
  }, [user]);

  const step = STEPS[index];

  useEffect(() => {
    if (!run) return;
    const place = () => setSpot(step.href ? menuItemRect(step.href) : null);
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [run, step]);

  const finish = () => {
    setRun(false);
    if (user) updateUserData(user.uid, { hasSeenNutriTour: true }).catch((error) => console.warn('Não foi possível salvar o tour:', error));
  };

  if (!run) return null;

  const isLast = index === STEPS.length - 1;
  const Icon = step.icon;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Tour da área de nutricionista">
      <div className="fixed inset-0 bg-slate-900/50" onClick={finish} aria-hidden="true" />

      {/* Anel pulsando em volta do item do menu de que o passo fala. */}
      {spot && (
        <motion.div
          key={step.href}
          className="fixed rounded-xl border-4 border-teal-300 pointer-events-none"
          style={{ top: spot.top - 4, left: spot.left - 4, width: spot.width + 8, height: spot.height + 8 }}
          initial={{ opacity: 0, scale: 1.3 }}
          animate={{ opacity: [0.5, 1, 0.5], scale: 1 }}
          transition={{ opacity: { duration: 1.4, repeat: Infinity }, scale: { duration: 0.35 } }}
        />
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-teal-100 p-5 space-y-4"
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -16, scale: 0.98 }}
          transition={{ duration: 0.22 }}
        >
          <button onClick={finish} aria-label="Fechar o tour" className="absolute top-3 right-3 p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3 pr-8">
            <motion.div
              className={`w-12 h-12 rounded-2xl ${step.color} text-white flex items-center justify-center shadow-md shrink-0`}
              initial={{ rotate: -20, scale: 0.6 }}
              animate={{ rotate: [0, -8, 8, 0], scale: 1, y: [0, -4, 0] }}
              transition={{ rotate: { duration: 0.6, delay: 0.15 }, scale: { type: 'spring', stiffness: 320, damping: 14 }, y: { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } }}
            >
              <Icon className="w-6 h-6" />
            </motion.div>
            <h3 className="text-lg font-bold text-slate-900 leading-tight">{step.title}</h3>
          </div>

          <p className="text-sm text-slate-600 leading-relaxed">{step.text}</p>

          <div className="flex items-center gap-1.5">
            {STEPS.map((item, position) => (
              <div key={item.title} className={`h-1.5 rounded-full transition-all duration-300 ${position === index ? 'w-6 bg-teal-600' : 'w-2 bg-slate-200'}`} />
            ))}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <button onClick={finish} className="text-xs font-medium text-slate-400 hover:text-slate-600">Pular tour</button>
            <div className="flex items-center gap-2">
              {index > 0 && (
                <button onClick={() => setIndex(index - 1)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-200">
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Voltar
                </button>
              )}
              <button
                onClick={() => (isLast ? finish() : setIndex(index + 1))}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg shadow-sm"
              >
                {isLast ? <><Check className="w-3.5 h-3.5" />Concluir</> : <>Próximo<ChevronRight className="w-3.5 h-3.5" /></>}
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
