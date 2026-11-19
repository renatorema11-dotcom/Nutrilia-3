# Ali: plano, diário e solicitações de consulta

O workflow é entregue **inativo**, com URL vazia e bloqueio de configuração. Testes locais não comprovam a integração real.

## Identidade e segredos

O componente autenticado ElevenLabsAgent abre a conversa com `patientUid` e `secret__patientToken` (ID token Firebase). Na ferramenta ElevenLabs, enviar o token no header `x-patient-token`; nunca em prompt ou campo preenchido pelo modelo.

| Ligação | Header | Onde configurar |
| --- | --- | --- |
| ElevenLabs → n8n | `x-ali-webhook-key` | Segredo da ferramenta e credencial Header Auth do webhook |
| n8n → app | `x-webhook-secret` | Credencial Header Auth do HTTP Request e `AGENT_API_SECRET` do servidor |

São dois segredos diferentes. O servidor exige `AGENT_API_SECRET` com no mínimo 32 caracteres e `FIREBASE_SERVICE_ACCOUNT_KEY` com JSON da conta de serviço do projeto correto. Não colocar segredos no GitHub, no workflow ou em variáveis NEXT_PUBLIC_. A variável antiga ELEVENLABS_WEBHOOK_SECRET não é utilizada.

A API verifica assinatura, validade, revogação e identidade do ID token com Firebase Admin. O UID do corpo sozinho não autoriza acesso. Contas anônimas e divergência entre UID e token são rejeitadas. Usa o banco nomeado em firebase-applet-config.json.

## Contrato

```json
{
  "action": "log_meal",
  "patientUid": "UID_DA_SESSAO",
  "confirmed": true,
  "payload": { "description": "Refeição fictícia", "mealTime": "almoço" }
}
```

| Ação | Payload | Resultado |
| --- | --- | --- |
| get_patient_data | objeto vazio | Dados resumidos e somente plano aprovado |
| log_measurement | weight, opcional bodyFat | Peso e histórico em patients/{uid} |
| log_meal | description, opcional mealTime | patients/{uid}/foodLogs |
| request_appointment | preferredDate, opcional notes | appointmentRequests com status pending; exige profissional vinculado |

A Ali deve repetir os dados e obter a confirmação do paciente antes de enviar confirmed=true. Esse campo é um contrato da ferramenta, não prova criptográfica de consentimento. Pedido de consulta depende de confirmação do profissional.

## Configuração e publicação

1. Hospedar o Next.js com runtime Node e HTTPS. O n8n remoto não acessa 127.0.0.1. Não é obrigatório comprar domínio se a hospedagem fornecer endereço HTTPS.
2. Configurar as variáveis de .env.example no servidor. Autorizar o hostname no Firebase Authentication e conferir o provedor Google.
3. Comparar as regras ativas do banco nomeado com firestore.rules antes de publicar alterações. Preservar índices existentes ao acrescentar os de firestore.indexes.json.
4. Importar o workflow e selecionar as credenciais nos nós Receber ação da Ali e Executar no NutriConnect.
5. Preencher appBaseUrl HTTPS no nó Configurar endereço e liberação. Com productionReady=false responde 503 sem gravar. Para teste controlado, liberar em uma cópia de teste com paciente fictício; publicar produção apenas depois da conferência nas telas.
6. Configurar a ferramenta ElevenLabs com URL do webhook, headers x-ali-webhook-key e x-patient-token e contrato acima. Desabilitar ferramentas antigas sem autenticação. O widget genérico não fornece token: usar ElevenLabsAgent do app.
7. Manter desabilitados armazenamento de dados de execução e retries de escrita. Após timeout, conferir o app antes de repetir: refeições e pedidos ainda não possuem chave de idempotência.

## Validação

```text
npm ci
npm run test:ali
npm run test:n8n
npm run typecheck
npm run lint
npm run build
```

Use Node 24 para test:ali. Firebase Admin e Firestore são simulados nesses testes. test:n8n executa os trechos do workflow, sem chamar serviços externos.

No teste real: entrar com paciente fictício, consultar plano aprovado, registrar refeição e medição, solicitar consulta e conferir persistência nas telas do paciente e profissional. Validar rejeição sem segredo, sem token e com UID divergente. Não registrar tokens em logs.

## Telas e limites

Diário e prontuário mostram refeições da Ali; agenda mostra pedidos pendentes. Os listeners Firestore são usados porque registros chegam por outro serviço e precisam aparecer em tempo real. Os indicadores do paciente leem o prontuário no carregamento; recarregar após medição quando não houver listener.

O diretório de nutricionistas e vínculo iniciado pelo paciente ainda precisam de fluxo autorizado: as regras atuais não permitem listar perfis privados de outros usuários nem mudar o profissional pelo cliente paciente. Não ampliar acesso a users para contornar isso. O teste da Ali deve usar um paciente previamente vinculado pelo profissional.
