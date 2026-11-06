import type { MetadataRoute } from 'next';

// Permite "Adicionar à tela inicial" no celular: o NutriAli abre em tela cheia, como um app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'NutriAli',
    short_name: 'NutriAli',
    description: 'Acompanhamento nutricional com a assistente de voz Ali.',
    // O login leva direto ao painel quando a pessoa já está conectada.
    start_url: '/login',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f0f9ff',
    theme_color: '#4c8466',
    lang: 'pt-BR',
    icons: [
      { src: '/icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon/maskable', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
