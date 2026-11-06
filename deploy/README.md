# Implantação Docker na Hostinger

O Dockerfile gera o Next.js standalone em Node 24 e executa o processo com usuário sem privilégios. O contexto exclui arquivos de ambiente e chaves. Nunca incluir segredos em build args; somente o ID público do agente é necessário no build.

Usar um projeto separado chamado nutriali na VPS existente, sem alterar os projetos n8n-aybm e traefik. O proxy observado usa network_mode=host, entrypoint websecure e certificado letsencrypt, e pode alcançar o container por sua rede Docker. Não publicar porta 3000 diretamente no host.

As labels devem rotear o hostname escolhido à porta 3000 do NutriAli. Fixar o build em um commit do GitHub para permitir rastrear e repetir a implantação. Conferir DNS antes de publicar.

As variáveis AGENT_API_SECRET, FIREBASE_SERVICE_ACCOUNT_KEY e GROQ_API_KEY são fornecidas somente no runtime pela configuração de ambiente da hospedagem. Sem credenciais Admin e segredo, a API da Ali permanece bloqueada com 503. A primeira publicação da interface não significa que a integração está pronta.

A IA dos chats, dos planos, da dica do dia, da análise de refeição e da foto do prato enviada para a Ali (POST /api/ali/meal-photo, que descreve o prato e estima as calorias em faixa) usa a Groq (GROQ_API_KEY). GROQ_MODEL e GROQ_VISION_MODEL são opcionais e trocam o modelo sem novo build. Sem GROQ_API_KEY, o app usa o Gemini se houver GEMINI_API_KEY; sem nenhuma das duas, essas funções respondem 503 com um aviso claro para a tela.

ADMIN_EMAILS (runtime, não é segredo) é o e-mail de quem aprova o cadastro de nutricionistas, separado por vírgula se houver mais de um. Quem se cadastra como nutricionista entra "em análise": não abre a área de nutricionista, não aparece para os pacientes e não passa nas rotas do servidor até ser aprovada em /admin/aprovacoes. O responsável é reconhecido pelo e-mail confirmado do login (entrar com o Google); os avisos (cadastro novo para ele, decisão para a nutricionista) saem pelo Gmail que ele conectou em "Minha Ali", e sem essa conexão a tela de aprovações continua funcionando. O aviso de cadastro novo leva um link assinado com AGENT_API_SECRET que abre /admin/aprovar já com os botões de aprovar e recusar, sem login: vale 30 dias, só para aquele cadastro, e nada é decidido só por abrir o link (a decisão é um POST em /api/admin/approval-link). Quem tiver o e-mail consegue decidir aquele cadastro, então o aviso não deve ser encaminhado. O CRN é conferido só no formato: a consulta pública do CFN não tem acesso automático, então a tela traz o link para o responsável conferir nome e situação antes de aprovar. Contas de nutricionista criadas antes disso (sem o campo approval) continuam aprovadas. As regras do banco (firestore.rules) precisam ser publicadas junto: são elas que impedem a pessoa de se aprovar sozinha.

ELEVENLABS_API_KEY (runtime) permite ao servidor emitir a credencial de cada conversa da Ali (POST /api/ali/session) para quem está logado. Ordem para ligar a autenticação dos agentes: primeiro o app no ar com a chave e as conversas funcionando, só depois "Ativar autenticação" nos dois agentes na ElevenLabs (tirando a lista de permitidos, que não se combina com autenticação). Sem a chave, a rota responde 503 e as telas usam só o ID do agente.

Depois de subir, conferir status saudável, HTTPS válido, página de login, hostname autorizado no Firebase Authentication, login real e rejeição de chamadas da Ali sem autenticação. Seguir n8n/README.md para parear as credenciais e testar com paciente fictício antes de ativar as ações.

O build Next.js e os testes passaram localmente; a imagem Docker precisa ser construída e verificada na VPS, pois Docker não está instalado no ambiente local.
