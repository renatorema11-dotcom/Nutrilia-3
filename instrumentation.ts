// O Next chama esta função quando uma tela ou rota do servidor quebra sem que o código tenha tratado o erro.
// O aviso leva só o endereço-modelo da tela ou rota (como /api/gemini/chat ou /nutritionist/patients/[id]).
import type { Instrumentation } from 'next';

const KIND: Record<string, string> = { render: 'na tela', route: 'na rota', action: 'na ação', middleware: 'no filtro de entrada' };

export const onRequestError: Instrumentation.onRequestError = async (error, _request, context) => {
  // A importação fica dentro deste "if": a versão "edge" do Next não tem o banco nem o Gmail e não pode levá-la junto.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Redirecionamentos e "página não encontrada" também passam como erro dentro do Next: não são falhas.
    const digest = (error as { digest?: unknown })?.digest;
    if (typeof digest === 'string' && /^(NEXT_|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING)/.test(digest)) return;
    const { notifyServerError } = await import('./lib/server-alerts');
    notifyServerError(`Erro inesperado ${KIND[context.routeType] || 'em'} ${context.routePath}.`, error);
  }
};
