import { getAdminDb, json } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Checagem simples de que o servidor fala com o banco. Não devolve detalhes do erro. */
export async function GET() {
  try {
    await getAdminDb().collection('test').doc('connection').get();
    return json({ status: 'success', message: 'Conexão com o banco de dados estabelecida.' });
  } catch {
    return json({ status: 'error', message: 'Não foi possível falar com o banco de dados agora.' }, 503);
  }
}
