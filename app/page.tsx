import Link from 'next/link';
import { Leaf, ArrowRight, ShieldCheck, Activity, Brain } from 'lucide-react';
import { Button } from '@/components/ui';

export default function Home() {
  return (
    <div className="min-h-screen bg-transparent flex flex-col relative z-10 text-slate-800">
      {/* Header */}
      <header className="w-full max-w-7xl mx-auto px-6 py-8 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-teal-600 rounded-xl flex items-center justify-center text-white shadow-lg">
            <Leaf className="h-7 w-7" />
          </div>
          <span className="text-2xl font-bold tracking-tight">NutriConnect</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/login">
            <Button variant="ghost" className="font-bold">Entrar</Button>
          </Link>
          <Link href="/register">
            <Button className="font-bold shadow-teal-600/30">Começar Agora</Button>
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center text-center px-6 py-20 max-w-4xl mx-auto">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-card border border-white/60 mb-8 text-sm font-semibold text-teal-800 shadow-sm">
          <SparklesIcon className="w-4 h-4" />
          <span>A primeira plataforma focada na conexão humana com IA</span>
        </div>
        
        <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight mb-6 leading-tight">
          Transformando o acompanhamento <br className="hidden md:block" />
          <span className="text-teal-700 relative whitespace-nowrap">
            nutricional
            <svg className="absolute -bottom-2 left-0 w-full h-3 text-teal-200 -z-10" viewBox="0 0 100 10" preserveAspectRatio="none">
              <path d="M0,5 Q50,0 100,5" stroke="currentColor" strokeWidth="8" fill="none" />
            </svg>
          </span>
        </h1>
        
        <p className="text-xl text-slate-600 mb-10 max-w-2xl leading-relaxed">
          Conectamos nutricionistas e pacientes em um ambiente interativo, inteligente e com 
          acompanhamento em tempo real, impulsionado por inteligência artificial.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-4">
          <Link href="/register">
            <Button className="h-14 px-8 text-lg rounded-xl flex items-center gap-2 shadow-lg shadow-teal-600/20">
              Criar Conta Grátis
              <ArrowRight className="w-5 h-5" />
            </Button>
          </Link>
        </div>

        {/* Features Preview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl mt-24">
          <div className="glass-card p-6 text-left flex flex-col gap-4">
            <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center">
              <Activity className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-lg">Evolução Contínua</h3>
            <p className="text-slate-600 text-sm leading-relaxed">
              Acompanhe medidas, peso e percentual de gordura em gráficos interativos e fáceis de entender.
            </p>
          </div>
          
          <div className="glass-card p-6 text-left flex flex-col gap-4">
            <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center">
              <Brain className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-lg">Assistente IA</h3>
            <p className="text-slate-600 text-sm leading-relaxed">
              Tire dúvidas rápidas, gere rascunhos de planos e receba insights valiosos sobre seus pacientes.
            </p>
          </div>

          <div className="glass-card p-6 text-left flex flex-col gap-4">
            <div className="w-12 h-12 bg-purple-100 text-purple-600 rounded-xl flex items-center justify-center">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-lg">Acesso Seguro</h3>
            <p className="text-slate-600 text-sm leading-relaxed">
              Planos e histórico de saúde protegidos, com total controle de acesso entre profissional e paciente.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

function SparklesIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}
