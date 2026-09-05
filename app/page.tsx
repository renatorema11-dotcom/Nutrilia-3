import Link from 'next/link';
import { Apple, ArrowRight, ShieldCheck, Activity, Brain, Mic, UserPlus, LineChart, Stethoscope, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui';
import { LanguageSelector } from '@/components/language-selector';

export default function Home() {
  return (
    <div className="min-h-screen bg-transparent flex flex-col relative z-10 text-slate-800">
      {/* Header */}
      <header className="w-full max-w-7xl mx-auto px-6 py-8 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-[#4c8466] rounded-xl flex items-center justify-center text-white shadow-lg">
            <Apple className="h-7 w-7" />
          </div>
          <span className="text-2xl font-bold tracking-tight text-[#276e58]">NutriAli</span>
        </div>
        <div className="flex items-center gap-3">
          <LanguageSelector />
          <Link href="/login">
            <Button variant="ghost" className="font-bold">Entrar</Button>
          </Link>
          <Link href="/register">
            <Button className="font-bold shadow-teal-600/30">Testar Grátis</Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center text-center px-6 py-16 max-w-5xl mx-auto">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-card border border-white/60 mb-8 text-sm font-semibold text-teal-800 shadow-sm">
          <Mic className="w-4 h-4" />
          <span>Assistente de voz com IA para consultórios de nutrição</span>
        </div>

        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-6 leading-tight">
          Seu acompanhamento nutricional{' '}
          <span className="text-teal-700 relative whitespace-nowrap">
            com voz própria
            <svg className="absolute -bottom-2 left-0 w-full h-3 text-teal-200 -z-10" viewBox="0 0 100 10" preserveAspectRatio="none">
              <path d="M0,5 Q50,0 100,5" stroke="currentColor" strokeWidth="8" fill="none" />
            </svg>
          </span>
        </h1>

        <p className="text-xl text-slate-600 mb-10 max-w-2xl leading-relaxed">
          O NutriAli dá ao seu paciente um assistente de voz, o Ali, disponível 24h para tirar
          dúvidas da dieta — e a você, um painel com planos gerados por IA e a evolução de cada
          paciente em gráficos claros.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-4">
          <Link href="/register">
            <Button className="h-14 px-8 text-lg rounded-xl flex items-center gap-2 shadow-lg shadow-teal-600/20">
              Começar teste grátis
              <ArrowRight className="w-5 h-5" />
            </Button>
          </Link>
          <a href="#como-funciona" className="text-sm font-semibold text-teal-700 hover:text-teal-800 underline underline-offset-4">
            Ver como funciona
          </a>
        </div>

        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl mt-20">
          <div className="glass-card p-6 text-left flex flex-col gap-4">
            <div className="w-12 h-12 bg-teal-100 text-teal-700 rounded-xl flex items-center justify-center">
              <Mic className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-lg">Ali, o assistente de voz</h3>
            <p className="text-slate-600 text-sm leading-relaxed">
              Seu paciente conversa com o Ali no app: tira dúvidas sobre o plano, consulta
              informações do acompanhamento e recebe orientação no horário da refeição.
            </p>
          </div>

          <div className="glass-card p-6 text-left flex flex-col gap-4">
            <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center">
              <Brain className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-lg">Planos com IA</h3>
            <p className="text-slate-600 text-sm leading-relaxed">
              Gere rascunhos de planos alimentares em segundos com IA, revise e publique com um
              clique. Você continua no controle — a IA acelera o trabalho manual.
            </p>
          </div>

          <div className="glass-card p-6 text-left flex flex-col gap-4">
            <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center">
              <LineChart className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-lg">Evolução em tempo real</h3>
            <p className="text-slate-600 text-sm leading-relaxed">
              Peso, medidas e percentual de gordura em gráficos interativos. Veja o progresso de
              todos os seus pacientes em um só painel.
            </p>
          </div>
        </div>

        {/* How it works */}
        <div id="como-funciona" className="w-full max-w-5xl mt-24 scroll-mt-20">
          <h2 className="text-3xl font-extrabold tracking-tight mb-10">Como funciona</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
            <div className="glass-card p-6 flex flex-col gap-3">
              <div className="w-8 h-8 rounded-full bg-[#4c8466] text-white font-bold flex items-center justify-center text-sm">1</div>
              <h3 className="font-bold flex items-center gap-2"><UserPlus className="w-4 h-4 text-teal-700" /> Cadastre seus pacientes</h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                Cada paciente recebe login próprio com senha temporária única — e troca a senha
                no primeiro acesso. Sem senhas compartilhadas.
              </p>
            </div>
            <div className="glass-card p-6 flex flex-col gap-3">
              <div className="w-8 h-8 rounded-full bg-[#4c8466] text-white font-bold flex items-center justify-center text-sm">2</div>
              <h3 className="font-bold flex items-center gap-2"><Mic className="w-4 h-4 text-teal-700" /> Eles conversam com o Ali</h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                No app do paciente, o Ali responde dúvidas sobre o plano e o acompanhamento,
                sempre com base nos dados que você cadastrou.
              </p>
            </div>
            <div className="glass-card p-6 flex flex-col gap-3">
              <div className="w-8 h-8 rounded-full bg-[#4c8466] text-white font-bold flex items-center justify-center text-sm">3</div>
              <h3 className="font-bold flex items-center gap-2"><Stethoscope className="w-4 h-4 text-teal-700" /> Você acompanha tudo</h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                Gere planos com IA, ajuste, publique e acompanhe a evolução de cada paciente no
                seu painel de nutricionista.
              </p>
            </div>
          </div>
        </div>

        {/* Pricing */}
        <div id="preco" className="w-full max-w-3xl mt-24 scroll-mt-20">
          <h2 className="text-3xl font-extrabold tracking-tight mb-4">Preço simples</h2>
          <p className="text-slate-600 mb-10">Sem contrato, sem taxa de instalação. Cancele quando quiser.</p>
          <div className="glass-card p-8 md:p-10 text-left rounded-2xl border border-white/60">
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
              <div>
                <p className="text-sm font-semibold text-teal-700 uppercase tracking-wide">Plano Profissional</p>
                <p className="mt-2"><span className="text-5xl font-extrabold">R$ 79</span><span className="text-slate-500 font-medium">/mês por nutricionista</span></p>
                <p className="text-sm text-slate-500 mt-1">30 dias grátis para testar. Preço de lançamento.</p>
              </div>
              <Link href="/register">
                <Button className="h-12 px-6 text-base rounded-xl font-bold shadow-lg shadow-teal-600/20">
                  Começar teste grátis
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                'Pacientes ilimitados no seu consultório',
                'Assistente de voz Ali no app do paciente',
                'Geração de planos alimentares com IA',
                'Gráficos de evolução peso, medidas e gordura',
                'App do paciente com login seguro individual',
                'Suporte direto com o time de desenvolvimento',
              ].map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm text-slate-700">
                  <CheckCircle2 className="w-4 h-4 text-teal-600 mt-0.5 shrink-0" />
                  {feature}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* FAQ */}
        <div id="faq" className="w-full max-w-3xl mt-24 text-left scroll-mt-20">
          <h2 className="text-3xl font-extrabold tracking-tight mb-8 text-center">Perguntas frequentes</h2>
          <div className="space-y-4">
            {[
              {
                q: 'Preciso instalar algo no meu computador?',
                a: 'Não. O NutriAli funciona no navegador do computador e do celular. Seus pacientes usam o mesmo site, com login próprio.',
              },
              {
                q: 'Os dados dos meus pacientes ficam seguros?',
                a: 'Sim. Cada paciente acessa apenas o próprio registro, com senha individual e troca obrigatória no primeiro login. O acesso aos dados é controlado por regras de segurança no banco, e nenhuma informação é vendida ou compartilhada.',
              },
              {
                q: 'A IA substitui o atendimento da nutricionista?',
                a: 'Não. A IA gera rascunhos de planos e responde dúvidas pontuais dos pacientes — sempre com base nos dados que você cadastrou. O diagnóstico e a prescrição continuam sendo seus.',
              },
              {
                q: 'E se eu quiser cancelar?',
                a: 'É só avisar um mês antes. Sem multa, sem fidelidade. Seus dados podem ser exportados a qualquer momento.',
              },
            ].map((item) => (
              <details key={item.q} className="glass-card p-5 rounded-xl border border-white/60 group">
                <summary className="font-bold cursor-pointer list-none flex items-center justify-between">
                  {item.q}
                  <span className="text-teal-700 group-open:rotate-45 transition-transform text-xl leading-none">+</span>
                </summary>
                <p className="mt-3 text-sm text-slate-600 leading-relaxed">{item.a}</p>
              </details>
            ))}
          </div>
        </div>

        {/* Final CTA */}
        <div className="mt-24 mb-8 text-center">
          <h2 className="text-3xl font-extrabold tracking-tight mb-4">
            Pronta para ter mais tempo pras suas pacientes?
          </h2>
          <p className="text-slate-600 mb-8">Comece hoje, grátis, com seus primeiros pacientes.</p>
          <Link href="/register">
            <Button className="h-14 px-8 text-lg rounded-xl flex items-center gap-2 shadow-lg shadow-teal-600/20 mx-auto">
              Criar minha conta grátis
              <ArrowRight className="w-5 h-5" />
            </Button>
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/60 py-8 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[#4c8466] rounded-lg flex items-center justify-center text-white">
              <Apple className="w-4 h-4" />
            </div>
            <span className="font-bold text-[#276e58]">NutriAli</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-slate-500">
            <a href="#como-funciona" className="hover:text-slate-700">Como funciona</a>
            <a href="#preco" className="hover:text-slate-700">Preço</a>
            <a href="#faq" className="hover:text-slate-700">Dúvidas</a>
            <span className="flex items-center gap-1"><ShieldCheck className="w-4 h-4" /> Dados protegidos</span>
          </div>
          <p className="text-xs text-slate-400">© 2026 NutriAli. Todos os direitos reservados.</p>
        </div>
      </footer>
    </div>
  );
}
