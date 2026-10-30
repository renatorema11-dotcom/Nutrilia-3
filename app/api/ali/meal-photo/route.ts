import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase-admin';
import { AiError, aiErrorResponse, generateAiJson } from '@/lib/ai';
import { clip, guardAi, parseImage } from '@/lib/ai-guard';
import { mealPhotoMessage, mealPhotoPrompt, normalizeMealPhoto, planSummary } from '@/lib/meal-photo';
import { addMealTaco } from '@/lib/meal-photo-taco';
import { PREMIUM_REQUIRED_MESSAGE } from '@/lib/premium';
import { hasPremium } from '@/lib/premium-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Foto maior que isto (cerca de 2,5 MB) não segue para a IA; a tela já reduz a foto antes de enviar.
const MAX_IMAGE_BASE64 = 3_500_000;

/** Objetivo e plano aprovado do paciente, para a IA comparar o prato. Se o banco falhar, a análise segue sem eles. */
async function patientContext(uid: string): Promise<{ objective: string; plan: string }> {
  try {
    const snap = await getAdminDb().collection('patients').doc(uid).get();
    const patient = snap.exists ? snap.data() || {} : {};
    return {
      objective: clip(patient.objective, 200),
      plan: patient.currentPlan?.status === 'approved' ? planSummary(patient.currentPlan) : '',
    };
  } catch (error) {
    console.warn('Foto do prato: não foi possível ler o prontuário.', error);
    return { objective: '', plan: '' };
  }
}

/**
 * Foto do prato enviada durante a conversa com a Ali. A IA de imagem descreve o prato, estima as porções e compara
 * com o plano; as calorias vêm da tabela TACO quando os itens são achados nela. A tela entrega esse texto à Ali, que
 * comenta por voz. A foto não é guardada pelo app.
 */
export async function POST(req: Request) {
  const guard = await guardAi(req, { roles: ['patient'], scope: 'ali-meal-photo', limit: 10, maxChars: 8_500_000 });
  if (!guard.ok) return guard.response;

  try {
    // Só JPEG, PNG ou WebP: outro tipo de arquivo não segue para a IA.
    const image = parseImage(guard.body.image);
    if (!image) return NextResponse.json({ error: 'Envie a foto em JPG, PNG ou WebP.' }, { status: 422 });
    if (image.data.length > MAX_IMAGE_BASE64) {
      return NextResponse.json({ error: 'A foto ficou grande demais. Tire outra ou escolha uma menor.' }, { status: 413 });
    }
    // A foto do prato é do Premium.
    if (!(await hasPremium(getAdminDb(), guard.caller.uid))) {
      return NextResponse.json({ error: PREMIUM_REQUIRED_MESSAGE, premium: true }, { status: 402 });
    }

    const context = await patientContext(guard.caller.uid);
    const when = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date());
    const data = await generateAiJson({ prompt: mealPhotoPrompt({ ...context, when }), image, maxTokens: 900 });
    const described = normalizeMealPhoto(data);
    if (!described) throw new AiError('A inteligência artificial não conseguiu descrever esta foto. Tente com outra foto.', 502);
    // Calorias e macros pela tabela TACO, com os pesos estimados pela foto; se essa parte falhar, fica a estimativa visual.
    const analysis = await addMealTaco(described);
    return NextResponse.json({ analysis, message: mealPhotoMessage(analysis) });
  } catch (error) {
    return aiErrorResponse(error, 'foto do prato para a Ali');
  }
}
