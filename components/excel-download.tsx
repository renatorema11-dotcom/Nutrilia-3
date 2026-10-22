'use client';

import { useState } from 'react';
import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui';
import type { SheetSpec } from '@/lib/sheet-specs';

/**
 * Botão "Baixar em Excel": monta a planilha no próprio navegador e baixa o arquivo .xlsx, sem precisar do Google.
 * O gerador (lib/xlsx.ts) só é carregado no clique, para a tela não ficar mais pesada.
 */
export function ExcelDownloadButton({ build, label = 'Baixar em Excel', className = '', disabled = false }: {
  build: () => Promise<SheetSpec>;
  label?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    try {
      const [spec, { buildXlsx, XLSX_MIME }, { sheetFileName }] = await Promise.all([build(), import('@/lib/xlsx'), import('@/lib/sheet-specs')]);
      const url = URL.createObjectURL(new Blob([buildXlsx(spec) as BlobPart], { type: XLSX_MIME }));
      const link = document.createElement('a');
      link.href = url;
      link.download = sheetFileName(spec.title, 'xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (error) {
      console.error('Erro ao montar a planilha do Excel:', error);
      alert('Não foi possível montar a planilha agora. Tente de novo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" onClick={download} disabled={busy || disabled} className={`gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50 ${className}`}>
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
      {label}
    </Button>
  );
}
