import { ImageResponse } from 'next/og';
import { AppIconArt } from '@/lib/app-icon';

// Ícone usado pelo iPhone em "Adicionar à Tela de Início" (o iOS arredonda os cantos sozinho).
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(<AppIconArt size={180} variant="fullBleed" />, size);
}
