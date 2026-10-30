import type { Metadata } from 'next';
import Link from 'next/link';
import { PRIVACY_CONTACT, PRIVACY_CONTROLLER, PRIVACY_VERSION_LABEL } from '@/lib/privacy';

export const metadata: Metadata = {
  title: 'Política de Privacidade | NutriAli',
  description: 'Como o NutriAli trata os seus dados, inclusive os de saúde, e como exercer os seus direitos pela LGPD.',
};

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="space-y-2">
    <h2 className="text-lg font-bold text-slate-800">{title}</h2>
    <div className="space-y-2 text-sm leading-relaxed text-slate-700">{children}</div>
  </section>
);

const mail = <a href={`mailto:${PRIVACY_CONTACT}`} className="font-semibold text-teal-700 underline">{PRIVACY_CONTACT}</a>;

/** Política de Privacidade e Termo de Consentimento. Pública: abre sem login. */
export default function PrivacyPage() {
  return (
    <main className="min-h-screen px-4 py-10">
      <article className="mx-auto w-full max-w-3xl space-y-8 rounded-2xl border border-white/60 bg-white/80 p-6 shadow-sm sm:p-10">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">NutriAli</p>
          <h1 className="text-2xl font-bold text-slate-900">Política de Privacidade e Termo de Consentimento</h1>
          <p className="text-sm text-slate-600">Versão de {PRIVACY_VERSION_LABEL}.</p>
        </header>

        <Section title="1. Quem somos">
          <p>
            O NutriAli é um aplicativo de acompanhamento nutricional que liga pacientes às suas nutricionistas.
            O responsável pelos seus dados (controlador) é a {PRIVACY_CONTROLLER}. Para qualquer assunto sobre os seus dados, escreva para {mail}.
          </p>
        </Section>

        <Section title="2. Que dados tratamos">
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>Cadastro:</strong> nome, e-mail, foto (se você enviar) e, no caso de nutricionistas, telefone e CRN.</li>
            <li><strong>Dados de saúde (dados sensíveis):</strong> idade, peso, altura, medidas, objetivo, plano alimentar, refeições e fotos de refeições que você registra, água, humor, consultas e as conversas com a sua nutricionista e com a Ali.</li>
            <li><strong>Uso do aplicativo:</strong> data do último acesso e o registro das ações da Ali, sem o conteúdo das mensagens.</li>
            <li><strong>Pagamentos:</strong> a situação das cobranças do Premium e das consultas (em aberto, paga, estornada), os valores e o código do cliente no Asaas. O CPF de quem paga e os dados do cartão vão direto para o Asaas e não ficam guardados no NutriAli.</li>
          </ul>
        </Section>

        <Section title="3. Para que usamos">
          <ul className="list-disc space-y-1 pl-5">
            <li>Permitir que a nutricionista que você escolheu acompanhe o seu tratamento e monte e ajuste o seu plano alimentar.</li>
            <li>Fazer funcionar a Ali, a assistente por voz e por texto, e as análises por inteligência artificial, como a estimativa de calorias de uma foto de refeição.</li>
            <li>Enviar lembretes de consulta e avisos de mensagem nova, de plano novo e de resposta a pedido de consulta.</li>
            <li>Cobrar o NutriAli Premium e as consultas pagas pelo aplicativo e repassar à nutricionista a parte dela.</li>
            <li>Manter o aplicativo seguro e funcionando.</li>
          </ul>
          <p>Não vendemos os seus dados e não os usamos para publicidade.</p>
        </Section>

        <Section title="4. Base legal">
          <p>
            Os dados de saúde são tratados com o seu consentimento específico e destacado, dado ao aceitar este termo (art. 11, I, da Lei Geral de Proteção de Dados),
            e para a tutela da saúde em procedimento realizado por profissional de saúde (art. 11, II, &quot;f&quot;). Os demais dados, inclusive os de pagamento, são tratados
            para prestar o serviço que você contratou (art. 7º, V) e para cumprir obrigações legais.
          </p>
        </Section>

        <Section title="5. Com quem os dados são compartilhados">
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>A sua nutricionista:</strong> vê o seu prontuário, os seus registros e as conversas com ela. Cada nutricionista só enxerga os próprios pacientes.</li>
            <li>
              <strong>Serviços que fazem o aplicativo funcionar</strong>, cada um só com o necessário: Google (Firebase, para o banco de dados e o login; Gmail, Google Agenda e Google Planilhas
              da nutricionista, quando ela os conecta, para e-mails, consultas e as planilhas que ela pede), ElevenLabs (voz da Ali), Groq (inteligência artificial, que recebe só o necessário para
              responder, sem o seu nome) e Hostinger (servidor onde o aplicativo funciona).
            </li>
            <li>
              <strong>Asaas</strong>, instituição de pagamento: recebe o nome, o e-mail e o CPF de quem paga para cobrar o Premium e as consultas; e, quando a nutricionista
              ativa os recebimentos, os dados da conta dela (CPF ou CNPJ, data de nascimento, telefone, endereço e renda), que também vão direto para o Asaas.
            </li>
            <li><strong>Google Tradutor</strong>, só quando você escolhe outro idioma no aplicativo: o texto da tela é enviado ao Google para ser traduzido.</li>
            <li>Alguns desses serviços guardam ou processam dados fora do Brasil, por exemplo nos Estados Unidos. Usamos serviços que adotam medidas de segurança e de proteção de dados.</li>
          </ul>
        </Section>

        <Section title="6. Por quanto tempo guardamos">
          <p>
            Enquanto a sua conta estiver ativa. Se você pedir a exclusão, os dados são apagados, exceto o que precisar ser guardado por obrigação legal ou regulatória,
            como o prontuário nutricional, pelo prazo exigido e só pelo tempo necessário.
          </p>
        </Section>

        <Section title="7. Seus direitos">
          <p>Você pode, a qualquer momento:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>confirmar se tratamos os seus dados e acessá-los: em Meu Perfil, botão &quot;Baixar meus dados&quot;;</li>
            <li>corrigir os seus dados: em Configurações e em Meu Perfil;</li>
            <li>pedir a exclusão da sua conta e revogar este consentimento: em Meu Perfil, botão &quot;Pedir exclusão da conta&quot;;</li>
            <li>pedir a portabilidade dos dados e informações sobre com quem eles são compartilhados.</li>
          </ul>
          <p>Também dá para fazer qualquer um desses pedidos pelo e-mail {mail}. Respondemos em até 15 dias.</p>
        </Section>

        <Section title="8. Segurança">
          <p>
            O acesso é protegido por login, as regras do banco de dados só liberam os dados para você e para a sua nutricionista, as conexões são criptografadas e as
            chaves de acesso aos serviços ficam só no servidor. Os avisos por e-mail não levam o conteúdo das mensagens nem dados de saúde.
          </p>
        </Section>

        <Section title="9. Crianças e adolescentes">
          <p>O cadastro de menores de 18 anos deve ser feito com o consentimento e o acompanhamento de pelo menos um dos pais ou do responsável legal.</p>
        </Section>

        <Section title="10. Nutricionistas">
          <p>Ao usar o NutriAli, a nutricionista se compromete a tratar os dados dos pacientes só para o acompanhamento nutricional, com sigilo profissional.</p>
        </Section>

        <Section title="11. Mudanças nesta política">
          <p>Se esta política mudar, avisamos no aplicativo e pedimos um novo aceite.</p>
        </Section>

        <Section title="Termo de consentimento">
          <p>
            Ao aceitar este termo no aplicativo, você autoriza o NutriAli a tratar os seus dados, inclusive os de saúde, para as finalidades descritas acima.
            Você pode revogar esse consentimento quando quiser, pedindo a exclusão da conta.
          </p>
        </Section>

        <footer className="border-t border-slate-200 pt-4 text-sm">
          <Link href="/" className="font-semibold text-teal-700 hover:text-teal-800">Voltar ao NutriAli</Link>
        </footer>
      </article>
    </main>
  );
}
