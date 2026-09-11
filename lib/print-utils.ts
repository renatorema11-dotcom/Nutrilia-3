export function handlePrintOrDownload(
  element: HTMLElement | null,
  documentTitle: string = 'Plano Alimentar',
  textContent?: string
) {
  if (!element && !textContent) return;

  const rawText = textContent || element?.innerText || '';
  const contentHtml = element
    ? element.innerHTML
    : `<div style="font-family: sans-serif; padding: 20px; white-space: pre-wrap;">${rawText}</div>`;

  // Try opening clean popup print window first
  try {
    const printWindow = window.open('', '_blank', 'width=800,height=900');
    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>${documentTitle}</title>
            <meta charset="utf-8">
            <style>
              body {
                font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                padding: 40px;
                color: #0f172a;
                line-height: 1.6;
              }
              h1, h2, h3, h4 { color: #0d9488; margin-top: 1.5em; margin-bottom: 0.5em; }
              ul, ol { padding-left: 20px; }
              li { margin-bottom: 4px; }
              p { margin-bottom: 1em; }
              @media print {
                body { padding: 0; }
                @page { margin: 1.5cm; }
              }
            </style>
          </head>
          <body>
            <div>${contentHtml}</div>
            <script>
              window.onload = function() {
                setTimeout(function() {
                  window.print();
                }, 300);
              };
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
      return;
    }
  } catch (err) {
    console.warn('Popup print blocked or unavailable:', err);
  }

  // Fallback 1: Direct window print with printable element styling
  if (element) {
    try {
      const existingStyle = document.getElementById('temp-print-style');
      if (existingStyle) existingStyle.remove();

      const style = document.createElement('style');
      style.id = 'temp-print-style';
      style.innerHTML = `
        @media print {
          body * { visibility: hidden !important; }
          #printable-area-temp, #printable-area-temp * { visibility: visible !important; }
          #printable-area-temp {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            padding: 20px !important;
          }
        }
      `;
      element.id = 'printable-area-temp';
      document.head.appendChild(style);

      window.print();

      setTimeout(() => {
        element.removeAttribute('id');
        style.remove();
      }, 1000);
      return;
    } catch (e) {
      console.warn('Direct print failed, falling back to download:', e);
    }
  }

  // Fallback 2: Download formatted text file
  try {
    const blob = new Blob([rawText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeTitle = (documentTitle || 'documento').toLowerCase().replace(/\s+/g, '_');
    a.download = `${safeTitle}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (downloadErr) {
    console.error('Download failed:', downloadErr);
  }
}
