import { POST as patientAction } from '../../agent/action/route';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ ok: false, speech: 'Corpo inválido.' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ ok: false, speech: 'Corpo inválido.' }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  // Identidade vem exclusivamente do token. Nome não seleciona prontuários.
  return patientAction(new Request(req.url, {
    method: 'POST', headers: req.headers,
    body: JSON.stringify({ action: 'get_patient_data', patientUid: input.patientUid }),
  }));
}
