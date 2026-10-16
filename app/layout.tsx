import type {Metadata, Viewport} from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/components/auth-provider';
import { DomPatch } from '@/components/dom-patch';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
});

export const metadata: Metadata = {
  title: 'NutriAli',
  description: 'Plataforma de conexão entre nutricionistas e pacientes, com acompanhamento de planos e IA.',
  applicationName: 'NutriAli',
  appleWebApp: {
    capable: true,
    title: 'NutriAli',
    statusBarStyle: 'default',
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Deixa o app usar a tela toda no iPhone; as barras respeitam o entalhe com safe-area.
  viewportFit: 'cover',
  themeColor: '#4c8466',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="pt-BR" className={`${inter.variable}`}>
      <body suppressHydrationWarning className="font-sans text-slate-800 min-h-screen relative">
        <DomPatch />
        <div className="mesh-bg"></div>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
