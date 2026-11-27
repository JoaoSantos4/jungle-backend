import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { banco } from '../../src/infraestrutura/banco/data-source';
import { CarteiraService } from '../../src/aplicacao/servicos/carteira.service';
import { TransacaoService } from '../../src/aplicacao/servicos/transacao.service';
import { sqs } from '../../src/infraestrutura/mensageria/sqs.client';
import { CreateQueueCommand, DeleteQueueCommand, GetQueueAttributesCommand, SendMessageCommand, ReceiveMessageCommand, ChangeMessageVisibilityCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';

const carteiras = new CarteiraService();
const transacoes = new TransacaoService();

function iniciarPublisher() {
  return Bun.spawn([process.execPath, 'tests/auxiliares/publisher-teste.ts'], {
    env: { ...process.env, WORKERS_ENABLED: 'true', OUTBOX_POLL_INTERVAL_MS: '100' },
    stdout: 'ignore', stderr: 'inherit'
  });
}

async function aguardarPublicacao(ids: string[]) {
  const limite = Date.now() + 60000;
  while (Date.now() < limite) {
    const registros: { published_at: Date | null }[] = await banco.manager.query(
      'SELECT published_at FROM outbox_messages WHERE id = ANY($1::uuid[])', [ids]
    );
    if (registros.length === ids.length && registros.every(r => r.published_at !== null)) return;
    await Bun.sleep(200);
  }
  throw new Error('Tempo limite aguardando publicacao outbox');
}

async function prepararEventos() {
  const playerId = crypto.randomUUID();
  const carteira = await carteiras.abrir(playerId, { amount: '100.00', currency: 'BRL' });
  const resultado = await transacoes.processar({ providerId: 'provider-mensageria', externalTransactionId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), playerId, walletId: carteira.id, roundId: crypto.randomUUID(), gameId: 'game-1', kind: 'BET', money: { amount: '80.00', currency: 'BRL' } });
  expect(resultado.status).toBe('PROCESSED');
  const eventos: { id: string; published_at: Date | null }[] = await banco.manager.query(
    `SELECT id, published_at FROM outbox_messages WHERE aggregate_id = $1 OR aggregate_id = $2 OR payload->'data'->>'transactionId' = $2::text`, [carteira.id, resultado.transactionId]
  );
  expect(eventos.length).toBeGreaterThanOrEqual(2);
  expect(eventos.every(e => e.published_at === null)).toBe(true);
  return { carteiraId: carteira.id, ids: eventos.map(e => e.id) };
}

async function conferir(carteiraId: string) {
  const resultado = await carteiras.reconciliar(carteiraId);
  expect(resultado.consistent).toBe(true);
  expect(resultado.storedBalance.amount).toBe('20.00');
  expect(resultado.checkedEntries).toBe(2);
}

describe('Mensageria - PostgreSQL e LocalStack', () => {
  beforeAll(async () => { await banco.initialize(); });
  afterAll(async () => { if (banco.isInitialized) await banco.destroy(); });

  test('Dois publishers independentes publicam eventos persistidos', async () => {
    const { carteiraId, ids } = await prepararEventos();
    const processos = [iniciarPublisher(), iniciarPublisher()];
    try {
      await aguardarPublicacao(ids);
      await conferir(carteiraId);
    } finally {
      for (const processo of processos) processo.kill();
      await Promise.all(processos.map(p => p.exited));
    }
  }, 90000);

  test('Novo publisher recupera eventos confirmados enquanto estava desligado', async () => {
    const anterior = iniciarPublisher();
    try { await Bun.sleep(500); } finally { anterior.kill(); await anterior.exited; }
    const { carteiraId, ids } = await prepararEventos();
    const novo = iniciarPublisher();
    try {
      await aguardarPublicacao(ids);
      await conferir(carteiraId);
    } finally { novo.kill(); await novo.exited; }
  }, 90000);

  test('SQS encaminha mensagem nao confirmada para DLQ apos cinco entregas', async () => {
    const prefixo = `teste-dlq-${crypto.randomUUID()}`;
    const dlq = await sqs.send(new CreateQueueCommand({ QueueName: `${prefixo}-dlq.fifo`, Attributes: { FifoQueue: 'true' } }));
    const urlDlq = dlq.QueueUrl!;
    let url: string | undefined;
    try {
      const atributos = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: urlDlq, AttributeNames: ['QueueArn'] }));
      const fila = await sqs.send(new CreateQueueCommand({ QueueName: `${prefixo}.fifo`, Attributes: { FifoQueue: 'true', VisibilityTimeout: '1', RedrivePolicy: JSON.stringify({ deadLetterTargetArn: atributos.Attributes!.QueueArn, maxReceiveCount: '5' }) } }));
      url = fila.QueueUrl!;
      const corpo = JSON.stringify({ messageId: crypto.randomUUID(), invalida: true });
      await sqs.send(new SendMessageCommand({ QueueUrl: url, MessageBody: corpo, MessageGroupId: 'teste', MessageDeduplicationId: crypto.randomUUID() }));
      for (let tentativa = 1; tentativa <= 5; tentativa++) {
        const resposta = await sqs.send(new ReceiveMessageCommand({ QueueUrl: url, WaitTimeSeconds: 5, VisibilityTimeout: 5, MessageSystemAttributeNames: ['ApproximateReceiveCount'] }));
        const mensagem = resposta.Messages?.[0];
        expect(mensagem?.Body).toBe(corpo);
        expect(mensagem?.Attributes?.ApproximateReceiveCount).toBe(String(tentativa));
        await sqs.send(new ChangeMessageVisibilityCommand({ QueueUrl: url, ReceiptHandle: mensagem!.ReceiptHandle!, VisibilityTimeout: 0 }));
      }
      // Uma nova leitura permite ao SQS aplicar a politica de redrive.
      await sqs.send(new ReceiveMessageCommand({ QueueUrl: url, WaitTimeSeconds: 2 }));
      const resposta = await sqs.send(new ReceiveMessageCommand({ QueueUrl: urlDlq, WaitTimeSeconds: 10 }));
      expect(resposta.Messages?.[0]?.Body).toBe(corpo);
      await sqs.send(new DeleteMessageCommand({ QueueUrl: urlDlq, ReceiptHandle: resposta.Messages![0]!.ReceiptHandle! }));
    } finally {
      if (url) await sqs.send(new DeleteQueueCommand({ QueueUrl: url }));
      await sqs.send(new DeleteQueueCommand({ QueueUrl: urlDlq }));
    }
  }, 60000);
});
