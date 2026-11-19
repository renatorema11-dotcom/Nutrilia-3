// Fotos tiradas no aparelho (só no navegador): reduzidas antes de sair, para ficarem leves para o banco e para a IA.

/** Reduz a foto para caber em maxSide pixels no lado maior e devolve em JPEG (data URL). */
export function shrinkPhoto(file: File, maxSide = 1024, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Foto inválida'));
    };
    img.src = url;
  });
}

/** Foto pronta para guardar ou enviar: reduzida; se o aparelho não conseguir reduzir, segue a original. */
export function photoDataUrl(file: File): Promise<string> {
  return shrinkPhoto(file).catch(() => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Foto inválida')));
    reader.onerror = () => reject(new Error('Foto inválida'));
    reader.readAsDataURL(file);
  }));
}
