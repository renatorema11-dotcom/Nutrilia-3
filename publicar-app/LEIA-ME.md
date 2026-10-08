# NutriAli no celular: arquivos para subir no GitHub

Esta pasta tem só os 23 arquivos que mudaram (18 alterados e 5 novos), nas mesmas pastas do projeto.
Não precisa subir este LEIA-ME.

## O que muda no app

- **Celular e tablet:** o menu lateral vira uma barra no topo (logo, idioma e botão de menu) e
  uma barra de navegação embaixo, como em app de celular. O menu completo abre de lado.
- **Computador:** continua igual.
- **Chats:** a conversa ocupa a tela entre as barras. A Ali aparece num cartão compacto em cima.
  No chat da nutricionista, aparece primeiro a lista de pacientes e depois a conversa, com botão de voltar.
- **Correção:** atualizar a página ou reabrir o app não manda mais quem está conectado de volta para o login.
- **Ícone na tela inicial:** dá para instalar o NutriAli no celular. Ele abre em tela cheia, com ícone próprio.
- **Ajustes menores:** cabeçalho da página inicial, separador "ou com email" do login e do cadastro,
  botão da ElevenLabs acima da barra inferior e lista de pacientes sem rolagem para o lado.

Já foi testado: verificação de tipos, lint, 30 testes de autenticação, 41 verificações do contrato n8n
e o build de produção. Tudo passou.

## 1. Subir no GitHub (não muda nada no ar)

1. Abra https://github.com/renatorema11-dotcom/Nutrilia-3
2. Troque a branch para **fix/ali-auth-github**. É a versão que está publicada.
3. Clique em **Add file → Upload files**.
4. Arraste as pastas **app**, **components** e **lib** desta pasta. O GitHub substitui os arquivos com o mesmo nome.
5. Escreva a mensagem "Versão para celular" e escolha **Commit directly to the fix/ali-auth-github branch**.
6. Clique em **Commit changes**.

## 2. Avise o Claude

Eu confiro se os 23 arquivos chegaram iguais e te passo o próximo passo: atualizar o projeto
**nutriali** na Hostinger para a versão nova.
