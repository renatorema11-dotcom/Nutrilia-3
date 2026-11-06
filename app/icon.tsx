import { ImageResponse } from 'next/og';
import { AppIconArt } from '@/lib/app-icon';

export const contentType = 'image/png';

// Gera /icon/192, /icon/512 e /icon/maskable (usados pelo manifest e como favicon).
export function generateImageMetadata() {
  return [
    { id: '192', size: { width: 192, height: 192 }, contentType: 'image/png' },
    { id: '512', size: { width: 512, height: 512 }, contentType: 'image/png' },
    { id: 'maskable', size: { width: 512, height: 512 }, contentType: 'image/png' },
  ];
}

export default function Icon({ id }: { id: string }) {
  const size = id === '192' ? 192 : 512;
  return new ImageResponse(
    <AppIconArt size={size} variant={id === 'maskable' ? 'maskable' : 'rounded'} />,
    { width: size, height: size },
  );
}
