# Ali com poder de execução (n8n)

O Ali (assistente de voz do ElevenLabs) deixa de ser somente leitura e passa a **executar ações** no acompanhamento do paciente, com o n8n atuando como gateway de execução.

## Fluxo

```
Paciente fala com o Ali (ElevenLabs)
        │
        ▼
Webhook do n8n (este workflow: nutriali-agent-actions.json)
        │
        ▼
POST /api/agent/action (Next.js na Vercel)
        │  header x-webhook-secret + body { action, patientUid, payload }
        ▼
Firestore (conta de serviço) + registro de auditoria em "aiActions"
```

## Ações disponíveis (allowlist)

| Ação | O que faz | Exemplo de fala do paciente |
|---|---|---|
| `get_patient_data` | Consulta os dados do acompanhamento | "Qual é o meu plano?" |
| `log_measurement` | Registra peso/gordura corporal do dia | "Meu peso hoje é 82,5" |
| `log_meal` | Adiciona refeição ao diário alimentar | "Comi frango com arroz no almoço" |
| `request_appointment` | Cria pedido de consulta (nutricionista aprova) | "Quero marcar uma consulta" |

**Guardrails:** o Ali só altera o documento do próprio paciente (identificado por UID), nenhuma ação apaga dados, e toda execução é registrada na coleção `aiActions` (trilha de auditoria).

## Setup

1. **Importar o workflow:** n8n → Workflows → Import from File → `n8n/nutriali-agent-actions.json`.
2. **Ajustar o nó "Executar Ação no NutriAli":**
   - URL: endereço de produção do app na Vercel + `/api/agent/action`
   - Header `x-webhook-secret`: o mesmo valor de `ELEVENLABS_WEBHOOK_SECRET` (ou `AGENT_API_SECRET`) configurado na Vercel.
3. **Ativar o workflow** e copiar a URL de produção do webhook (Production URL).
4. **No ElevenLabs (agente Ali):** trocar/adicionar a ferramenta de webhook apontando para a URL do n8n, enviando o JSON:
   ```json
   {
     "action": "log_measurement",
     "patientUid": "UID_DO_PACIENTE_DA_SESSÃO",
     "payload": { "weight": 82.5 }
   }
   ```
   O `patientUid` deve vir da sessão autenticada do paciente (variável dinâmica do ElevenLabs), nunca digitado à mão — é ele que impede um paciente de alterar o documento de outro.
5. **Redeploy na Vercel** para o novo endpoint `/api/agent/action` entrar no ar.

## Teste rápido (sem ElevenLabs)

```bash
curl -X POST https://SEU-APP.vercel.app/api/agent/action \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: SEU-SEGREDO" \
  -d '{"action":"log_measurement","patientUid":"UID_DE_TESTE","payload":{"weight":82.5}}'
```

Resposta esperada: `{"ok":true,"speech":"Perfeito! Registrei 82.5 kg ..."}`
