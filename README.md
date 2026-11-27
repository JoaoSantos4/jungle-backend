# jungle-backend
Oi dev, me chamo Joao Santos esse e o meu teste de serviço financeiro para processamento de transações.

tecnologias que utilizei:
- Bun 1.x, TypeScript strict e NestJS
- PostgreSQL 16, TypeORM e decimal.js
- AWS SQS com LocalStack e Docker Compose
- Pino e Prometheus (prom-client)

Executando localmente!
Requisitos: Bun, Docker com Compose e portas 5432, 4566 e 3000 disponíveis.

lança no terminal:
bun install
Copy-Item .env.example .env

após isso recomendo verificar se os valores são:
DB_HOST=localhost
DB_PORT=5432
DB_NAME=jungle
DB_USER=jungle
DB_PASSWORD=jungle_dev
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
SQS_ENDPOINT=http://localhost:4566
SQS_QUEUE_NAME=wager-transactions.fifo
SQS_DLQ_NAME=wager-transactions-dlq.fifo
SQS_EVENTS_QUEUE_NAME=wager-events.fifo
PORT=3000
LOG_LEVEL=info
WORKERS_ENABLED=true
OUTBOX_POLL_INTERVAL_MS=1000

como é um teste, decidi colocar os dados no .env.exemple e aqui no readme.md!

após confirmar temos os comandos para rodar no terminal novamente
docker compose up -d
docker compose ps
bun run migration:run
bun run start

quando estiver tudo ok poderá rodar o
bun run dev

e para reverter a ultima migration em um banco descartavel temos
bun run migration:revert 

A API é base local http://localhost:3000

seguindo, temos as rotas solicitadas:

Método --- Rota --- Finalidade
POST = /wallets = abrir carteira
GET = 	/wallets/:walletId = consultar carteira
GET = 	/wallets/:walletId/ledger = consultar histórico paginado (cursor e limit)
POST = 	/wallets/:walletId/reconciliation = comparar saldo com ledger
POST = 	/wagering/transactions = processar transação
GET = /wagering/transactions/:transactionId = consultar transação
GET = 	/providers/:providerId/wagering/transactions/:externalTransactionId = consultar por provedor
GET = 	/health/live = liveness
GET = 	/health/ready = readiness
GET = 	/metrics = métricas prometheus

Vamos para os exemplos:

$base = 'http://localhost:3000'
$jogador = [guid]::NewGuid().ToString()
$carteira = Invoke-RestMethod -Method Post -Uri "$base/wallets" -ContentType 'application/json' -Body (@{
  playerId = $jogador
  initialBalance = @{ amount = '100.00'; currency = 'BRL' }
} | ConvertTo-Json -Depth 5)
$carteira

precisa usar o identificador retornado nesse proximo exemplo: 

$walletId = 'UUID-DA-CARTEIRA'
$externo = [guid]::NewGuid().ToString()
$headers = @{ 'Idempotency-Key' = "provider-teste:$externo" }
$body = @{
  providerId = 'provider-teste'
  externalTransactionId = $externo
  playerId = $jogador
  walletId = $walletId
  roundId = [guid]::NewGuid().ToString()
  gameId = 'game-1'
  kind = 'BET'
  money = @{ amount = '80.00'; currency = 'BRL' }
} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post -Uri "$base/wagering/transactions" -Headers $headers -ContentType 'application/json' -Body $body

O saldo tem que ficar 20.00, repetir a mesma requisição com essa mesma chave nao vai gerar outro debito e alterar o conteudo mantendo a chave gera conflito
Os valores financeiros são strings decimais e a moeda operacional é BRL
REFUND e ROLLBACK exigem referenceExternalTransactionId 

So especifiquei para mostrar que li a doc, risos 

Invoke-RestMethod -Method Post -Uri "$base/wallets/$walletId/reconciliation" = verifica se o saldo corresponde ao historico de movimentações no ledger.
Invoke-RestMethod -Uri "$base/health/ready" = verifica se a aplicação esta pronta para receber requisições
Invoke-RestMethod -Uri "$base/metrics" = volta as metricas que adicionei na observabilidade,  resume a transações processadas, mensagens duplicadas, tentativas de reprocessamento, latencia, eventos pendentes no Outbox e divergências financeiras


Mensageria: 
a fila de entrada: wager-transactions.fifo 
a DLQ: wager-transactions-dlq.fifo
os eventos: wager-events.fifo

a mensagem de entrada contém messageId, type, WagerTransactionRequested, ocurredAt e data
é os mesmos campos da transação HTTP, incluindo idempotencyKey
use o walletId como MesageGroupld e um identificador de transporte como MessageDeduplicationId
e claro que a deduplicação financeira nao depende do FIFO

os testes:
lança no terminal dnv os comandos
bun run check
bun test
bun test tests/integracao/distribuido.test.ts
bun test tests/integracao/mensageria.test.ts

vai verificar que os testes tem dominio, PostgreSQL, processos independentes, referencias pendentes, recuperação e o SQS local
ah e utilize em um ambiente dedicado pois os testes persistem registros e podem publicar ou consumir mensagens!!!!!!!!!!


aqui é a parte da estruturação:
src/domain = entidades, value objects, enums e eventos.
src/aplicação = serviços e contratos.
src/infraestrutura: banco, HTTP, mensageria, workers e observabilidade.
tests = integração distribuída e processos auxiliares. (confesso que usei um tanto bom de IA aqui, pois ao meu ver é realmente importante testarmos bem haha)


acho que é isso dev, peço desculpas por ficar meio bagunçadinho, acontece optei por nao utilizar tanta IA e que por mais que o prazo foi 3 dias eu desenvolvi em 2 noites pois trabalho em 2 bares, minha mae esta doente entao nao consegui muito tempo, o esquema foi ficar 2 dias virados desenvolvendo esse projeto, e aliais, parabens para o dev que pensou, achei bem gostoso de fazer haha.
Queria falar que programei nao apenas pensando no cenário em que tudo funciona, mas pensei tambem nos cenários em que alguma coisa falha, pois acredito que a doc deixou isso beem claro.
se verificar o ARCHITECTURE.md vai ver as decisões, garantias e limitações do desafio tecnico.