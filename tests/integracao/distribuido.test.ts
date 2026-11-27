import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { banco } from '../../src/infraestrutura/banco/data-source';
import { CarteiraService } from '../../src/aplicacao/servicos/carteira.service';
import { TransacaoService } from '../../src/aplicacao/servicos/transacao.service';
import { InboxService } from '../../src/aplicacao/servicos/inbox.service';
import type { TransacaoDto } from '../../src/aplicacao/contratos/transacao.dto';
import type { MensagemTransacao } from '../../src/aplicacao/servicos/inbox.service';
import { sqs } from '../../src/infraestrutura/mensageria/sqs.client';
import { CreateQueueCommand, DeleteQueueCommand, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const carteiras = new CarteiraService();
const transacoes = new TransacaoService();
const inbox = new InboxService(transacoes);
async function preparar(): Promise<TransacaoDto> {
  const playerId = crypto.randomUUID();
  const carteira = await carteiras.abrir(playerId, { amount: '100.00', currency: 'BRL' });
  return { playerId, walletId: carteira.id, providerId: 'provider-distribuido', externalTransactionId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), roundId: crypto.randomUUID(), gameId: 'game-1', kind: 'BET', money: { amount: '80.00', currency: 'BRL' } };
}
async function conferir(id: string, saldo: string, quantidade: number) {
  const resultado = await carteiras.reconciliar(id);
  expect(resultado.consistent).toBe(true);
  expect(resultado.storedBalance.amount).toBe(saldo);
  expect(resultado.checkedEntries).toBe(quantidade);
}
function mensagem(data: TransacaoDto): MensagemTransacao {
  return { messageId: crypto.randomUUID(), type: 'WagerTransactionRequested', occurredAt: new Date().toISOString(), data };
}
function iniciar(modo: string, entrada: string, arquivo: string) {
  return Bun.spawn([process.execPath, 'tests/auxiliares/worker-teste.ts', modo, entrada, arquivo], { stdout: 'ignore', stderr: 'inherit' });
}

describe('Integracao distribuida', () => {
  beforeAll(async () => { await banco.initialize(); });
  afterAll(async () => { if (banco.isInitialized) await banco.destroy(); });

  test('Tres processos independentes disputam a mesma carteira', async () => {
    const entrada = await preparar();
    const pasta = mkdtempSync(join(tmpdir(), 'jungle-'));
    const arquivos = [0, 1, 2].map(i => join(pasta, `${i}.json`));
    const processos = arquivos.map(arquivo => iniciar('aposta', JSON.stringify({ ...entrada, externalTransactionId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() }), arquivo));
    try {
      expect(await Promise.all(processos.map(p => p.exited))).toEqual([0, 0, 0]);
      const resultados = arquivos.map(a => JSON.parse(readFileSync(a, 'utf8')));
      expect(resultados.filter(r => r.status === 'PROCESSED')).toHaveLength(1);
      expect(resultados.filter(r => r.status === 'REJECTED' && r.failureCode === 'INSUFFICIENT_FUNDS')).toHaveLength(2);
      await conferir(entrada.walletId, '20.00', 2);
    } finally { for (const p of processos) p.kill(); rmSync(pasta, { recursive: true, force: true }); }
  }, 30000);

  test('Carteira bloqueada nao impede outra carteira', async () => {
    const a = await preparar(); const b = await preparar();
    await banco.transaction(async gerenciador => {
      await gerenciador.query('SELECT id FROM wallets WHERE id = $1 FOR UPDATE', [a.walletId]);
      const resultado = await transacoes.processar(b);
      expect(resultado.status).toBe('PROCESSED');
    });
    await conferir(a.walletId, '100.00', 1);
    await conferir(b.walletId, '20.00', 2);
  }, 15000);

  test('Ledger nao permite alteracao ou exclusao', async () => {
    const entrada = await preparar();
    await expect(banco.manager.query('UPDATE wallet_ledger_entries SET amount = amount WHERE wallet_id = $1', [entrada.walletId])).rejects.toThrow();
    await expect(banco.manager.query('DELETE FROM wallet_ledger_entries WHERE wallet_id = $1', [entrada.walletId])).rejects.toThrow();
    await conferir(entrada.walletId, '100.00', 1);
  });

  test('Inbox reverte registro quando processamento falha', async () => {
    const entrada = await preparar();
    const msg = mensagem({ ...entrada, walletId: crypto.randomUUID() });
    await expect(inbox.processar(msg)).rejects.toThrow('WALLET_NOT_FOUND');
    const registros = await banco.manager.query('SELECT * FROM inbox_messages WHERE message_id = $1', [msg.messageId]);
    expect(registros).toHaveLength(0);
    await conferir(entrada.walletId, '100.00', 1);
  });

  test('SQS entrega novamente apos processo morrer depois do commit', async () => {
    const entrada = await preparar(); const msg = mensagem(entrada);
    const fila = await sqs.send(new CreateQueueCommand({ QueueName: `teste-${crypto.randomUUID()}.fifo`, Attributes: { FifoQueue: 'true', ContentBasedDeduplication: 'false' } }));
    const url = fila.QueueUrl!;
    const pasta = mkdtempSync(join(tmpdir(), 'jungle-'));
    const arquivo = join(pasta, 'commit');
    try {
      await sqs.send(new SendMessageCommand({ QueueUrl: url, MessageBody: JSON.stringify(msg), MessageGroupId: entrada.walletId, MessageDeduplicationId: crypto.randomUUID() }));
      const processo = iniciar('inbox', url, arquivo);
      try {
        for (let i = 0; i < 200 && !existsSync(arquivo); i++) await Bun.sleep(50);
        expect(existsSync(arquivo)).toBe(true);
      } finally { processo.kill(); await processo.exited; }
      const resposta = await sqs.send(new ReceiveMessageCommand({ QueueUrl: url, WaitTimeSeconds: 10, MessageSystemAttributeNames: ['ApproximateReceiveCount'] }));
      const recebida = resposta.Messages?.[0];
      expect(recebida?.Attributes?.ApproximateReceiveCount).toBe('2');
      expect(recebida?.Body).toBeDefined();
      const retorno = await inbox.processar(JSON.parse(recebida!.Body!));
      expect(retorno.duplicada).toBe(true);
      await sqs.send(new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: recebida!.ReceiptHandle! }));
      const registros = await banco.manager.query('SELECT processed_at FROM inbox_messages WHERE message_id = $1', [msg.messageId]);
      expect(registros).toHaveLength(1); expect(registros[0].processed_at).not.toBeNull();
      const eventos = await banco.manager.query('SELECT event_type FROM outbox_messages WHERE payload->>\'correlationId\' = $1', [msg.messageId]);
      expect(eventos.map((e: {event_type: string}) => e.event_type).sort()).toEqual(['WagerTransactionProcessed', 'WalletBalanceChanged'].sort());
      await conferir(entrada.walletId, '20.00', 2);
    } finally { await sqs.send(new DeleteQueueCommand({ QueueUrl: url })); rmSync(pasta, { recursive: true, force: true }); }
  }, 45000);
});
