// Arte do ícone do app (maçã do lucide sobre o verde da marca), usada nos ícones gerados
// pelo Next: favicon, ícone de "Adicionar à tela inicial" e ícone do iPhone.
const APPLE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 6.528V3a1 1 0 0 1 1-1h0"/>' +
  '<path d="M18.237 21A15 15 0 0 0 22 11a6 6 0 0 0-10-4.472A6 6 0 0 0 2 11a15.1 15.1 0 0 0 3.763 10 3 3 0 0 0 3.648.648 5.5 5.5 0 0 1 5.178 0A3 3 0 0 0 18.237 21"/>' +
  '</svg>';

const APPLE_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(APPLE_SVG)}`;

/**
 * rounded: cantos arredondados com fundo transparente (favicon e ícone comum).
 * fullBleed: quadrado inteiro verde; o sistema recorta (iPhone e ícone "maskable" do Android).
 */
export function AppIconArt({ size, variant }: { size: number; variant: 'rounded' | 'fullBleed' | 'maskable' }) {
  // No "maskable" o desenho precisa caber na área segura central (círculo de 80%).
  const glyph = Math.round(size * (variant === 'maskable' ? 0.44 : 0.56));
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#4c8466',
        borderRadius: variant === 'rounded' ? Math.round(size * 0.22) : 0,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={APPLE_DATA_URI} width={glyph} height={glyph} alt="" />
    </div>
  );
}
