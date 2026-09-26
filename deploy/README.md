# Implantação Docker na Hostinger

O Dockerfile gera o Next.js standalone em Node 24 e executa o processo com usuário sem privilégios. O contexto exclui arquivos de ambiente e chaves. Nunca incluir segredos em build args; somente o ID público do agente é necessário no build.

Usar um projeto separado chamado nutriali na VPS existente, sem alterar os projetos n8n-aybm e traefik. O proxy observado usa network_mode=host, entrypoint websecure e certificado letsencrypt, e pode alcançar o container por sua rede Docker. Não publicar porta 3000 diretamente no host.

As labels devem rotear o hostname escolhido à porta 3000 do NutriAli. Fixar o build em um commit do GitHub para permitir rastrear e repetir a implantação. Conferir DNS antes de publicar.

As variáveis AGENT_API_SECRET, FIREBASE_SERVICE_ACCOUNT_KEY e GEMINI_API_KEY são fornecidas somente no runtime pela configuração de ambiente da hospedagem. Sem credenciais Admin e segredo, a API da Ali permanece bloqueada com 503. A primeira publicação da interface não significa que a integração está pronta.

Depois de subir, conferir status saudável, HTTPS válido, página de login, hostname autorizado no Firebase Authentication, login real e rejeição de chamadas da Ali sem autenticação. Seguir n8n/README.md para parear as credenciais e testar com paciente fictício antes de ativar as ações.

O build Next.js e os testes passaram localmente; a imagem Docker precisa ser construída e verificada na VPS, pois Docker não está instalado no ambiente local.
