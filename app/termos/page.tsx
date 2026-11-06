import type { Metadata } from 'next';
import Link from 'next/link';
import { PRIVACY_CONTACT } from '@/lib/privacy';

export const metadata: Metadata = {
  title: 'Termos de Uso | NutriAli',
  description: 'As regras de uso do NutriAli para nutricionistas e pacientes: contas, inteligência artificial, planos, cancelamento e responsabilidades.',
};

const TERMS_VERSION_LABEL = '29 de outubro de 2026';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-2">
    <h2 className="text-lg font-bold text-slate-800">{title}</h2>
    <div className="space-y-2 text-sm leading-relaxed text-slate-700">{children}</div>
  </section>
);

const mail = <a href={`mailto:${PRIVACY_CONTACT}`} className="font-semibold text-teal-700 underline">{PRIVACY_CONTACT}</a>;

/** Termos de Uso. Públicos: abrem sem login. O mesmo texto está no site (nutriali.cloud/termos). */
export default function TermsPage() {
  return (
    <main className="min-h-screen px-4 py-10">
      <article className="mx-auto w-full max-w-3xl space-y-8 rounded-2xl border border-white/60 bg-white/80 p-6 shadow-sm sm:p-10">
        <header className="space-y-2">
          <p translate="no" className="text-xs font-semibold uppercase tracking-wider text-teal-700">NutriAli</p>
          <h1 className="text-2xl font-bold text-slate-900">Termos de Uso</h1>
          <p className="text-sm text-slate-600">Versão de {TERMS_VERSION_LABEL}.</p>
        </header>

        <Section title="1. O que é o NutriAli">
          <p>
            O NutriAli é uma plataforma que liga nutricionistas e pacientes. A nutricionista acompanha os pacientes, monta e aprova planos alimentares
            e conversa com eles; o paciente segue o plano, registra refeições, peso, água e humor e conversa com a Ali, a assistente por voz e por texto.
            Ao criar uma conta ou usar o NutriAli, você concorda com estes termos e com a <Link href="/privacidade" className="font-semibold text-teal-700 underline">Política de Privacidade</Link>.
          </p>
        </Section>

        <Section title="2. Quem pode usar">
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>Nutricionistas</strong> com registro ativo no Conselho Regional de Nutricionistas (CRN). O cadastro só é liberado depois que conferimos o registro.</li>
            <li><strong>Pacientes</strong> cadastrados pela própria nutricionista ou que criam a conta e escolhem uma nutricionista do NutriAli.</li>
            <li>Menores de 18 anos só podem usar com o consentimento e o acompanhamento de pelo menos um dos pais ou do responsável legal.</li>
          </ul>
        </Section>

        <Section title="3. Sua conta">
          <p>
            A conta é pessoal. Não compartilhe a sua senha; quem recebe uma senha temporária precisa trocá-la no primeiro acesso.
            Se perceber qualquer uso que não foi seu, troque a senha e avise pelo e-mail {mail}.
          </p>
        </Section>

        <Section title="4. A inteligência artificial e a Ali não substituem a nutricionista">
          <ul className="list-disc space-y-1 pl-5">
            <li>Os rascunhos de plano, as dicas, as análises de foto de refeição e as respostas da Ali são feitos por inteligência artificial e podem conter erros.</li>
            <li>Um plano alimentar só vale depois de revisado e aprovado pela nutricionista. Diagnóstico e prescrição são sempre dela.</li>
            <li>A Ali não faz diagnóstico, não prescreve e não muda o plano aprovado. Ela tira dúvidas sobre o plano, registra informações e encaminha pedidos.</li>
            <li><strong>O NutriAli não é um serviço de emergência.</strong> Em caso de mal-estar ou urgência, ligue 192 (SAMU) ou procure um serviço de saúde.</li>
          </ul>
        </Section>

        <Section title="5. Responsabilidades da nutricionista">
          <ul className="list-disc space-y-1 pl-5">
            <li>Atuar de acordo com o Código de Ética e as resoluções do Conselho Federal de Nutricionistas, inclusive no atendimento a distância.</li>
            <li>Revisar e aprovar tudo o que for para o paciente e manter corretos os dados que cadastra.</li>
            <li>Cadastrar só pacientes que concordaram em ser acompanhados pelo NutriAli e tratar os dados deles com sigilo profissional.</li>
            <li>Responder pelos e-mails, convites e consultas que pedir à Ali, inclusive os enviados pelo Google que ela conectar.</li>
          </ul>
        </Section>

        <Section title="6. Responsabilidades do paciente">
          <p>
            Informar dados verdadeiros, seguir as orientações da sua nutricionista e procurar um profissional de saúde sempre que tiver sintomas ou dúvidas
            que o aplicativo não resolva.
          </p>
        </Section>

        <Section title="7. O que não é permitido">
          <ul className="list-disc space-y-1 pl-5">
            <li>Tentar acessar dados de outras pessoas ou burlar as proteções do aplicativo.</li>
            <li>Usar o NutriAli para fins ilegais, para enviar conteúdo ofensivo ou para mensagens que a outra pessoa não pediu.</li>
            <li>Copiar, revender ou automatizar o acesso ao serviço sem a nossa autorização.</li>
          </ul>
        </Section>

        <Section title="8. Valores, comissão e Premium">
          <ul className="list-disc space-y-1 pl-5">
            <li>Para nutricionistas, o NutriAli não cobra mensalidade. Quando o paciente paga uma consulta ou outro serviço pelo aplicativo, o NutriAli fica com 10% do valor líquido (depois da taxa do meio de pagamento) e o restante vai automaticamente para a conta da nutricionista no Asaas.</li>
            <li>Os pagamentos são processados pelo Asaas, instituição de pagamento. Prazos de recebimento, taxas e estornos seguem as regras do Asaas.</li>
            <li>Para pacientes, o aplicativo é gratuito. O NutriAli Premium é uma assinatura opcional, pelo valor informado no aplicativo, que libera funções extras. Ela pode ser cancelada quando o paciente quiser, sem multa, e vale até o fim do período já pago.</li>
            <li>Pedidos de reembolso de consultas pagas pelo app são analisados pela nutricionista; quando houver estorno, ele é feito pelo Asaas.</li>
          </ul>
        </Section>

        <Section title="9. Seus dados">
          <p>
            O tratamento dos dados pessoais, inclusive os de saúde, segue a <Link href="/privacidade" className="font-semibold text-teal-700 underline">Política de Privacidade</Link>.
            Você pode baixar os seus dados e pedir a exclusão da conta em Meu Perfil. Os dados que você coloca no NutriAli continuam seus.
          </p>
        </Section>

        <Section title="10. Disponibilidade">
          <p>
            Trabalhamos para manter o NutriAli sempre no ar, mas podem acontecer interrupções para manutenção ou por falhas de serviços de terceiros que
            usamos (como Google, ElevenLabs, Groq e Hostinger). Por isso, guarde uma cópia do que for importante, por exemplo com o botão &quot;Baixar em Excel&quot;.
          </p>
        </Section>

        <Section title="11. Propriedade intelectual">
          <p>
            A marca, o aplicativo, o site e os textos do NutriAli pertencem ao NutriAli. Você recebe o direito de usar o serviço enquanto a sua conta
            estiver ativa, sem transferir nenhum desses direitos.
          </p>
        </Section>

        <Section title="12. Limites da nossa responsabilidade">
          <p>
            O NutriAli é uma ferramenta de apoio ao acompanhamento nutricional; as decisões clínicas são da nutricionista. Nos limites da lei, não respondemos
            por danos causados pelo uso em desacordo com estes termos ou por informações incorretas cadastradas pelos usuários. Nada aqui afasta os direitos
            garantidos pelo Código de Defesa do Consumidor.
          </p>
        </Section>

        <Section title="13. Suspensão e encerramento">
          <p>
            Podemos suspender ou encerrar contas que descumpram estes termos ou cujo registro profissional não seja confirmado. Você pode encerrar a sua conta
            a qualquer momento, pedindo a exclusão em Meu Perfil.
          </p>
        </Section>

        <Section title="14. Mudanças nestes termos">
          <p>Se estes termos mudarem, avisamos no aplicativo e no site antes de a mudança valer.</p>
        </Section>

        <Section title="15. Lei e foro">
          <p>Estes termos seguem as leis do Brasil. Fica eleito o foro do domicílio do usuário.</p>
        </Section>

        <Section title="16. Contato">
          <p>Dúvidas, pedidos e reclamações: {mail}.</p>
        </Section>

        <footer className="border-t border-slate-200 pt-4 text-sm">
          <Link href="/" className="font-semibold text-teal-700 hover:text-teal-800">Voltar ao NutriAli</Link>
        </footer>
      </article>
    </main>
  );
}
