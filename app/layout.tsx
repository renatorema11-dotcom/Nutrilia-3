import type {Metadata} from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/components/auth-provider';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'NutriConnect',
  description: 'Plataforma de conexão entre nutricionistas e pacientes, com acompanhamento de planos e IA.',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="pt-BR" className={`${inter.variable}`}>
      <body suppressHydrationWarning className="font-sans text-slate-800 min-h-screen relative">
        <div className="mesh-bg"></div>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
