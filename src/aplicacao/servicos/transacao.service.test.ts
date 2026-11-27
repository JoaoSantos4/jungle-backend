import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { banco } from '../../infraestrutura/banco/data-source';
import { CarteiraService } from './carteira.service';
import { TransacaoService } from './transacao.service';
import type { TransacaoDto } from '../contratos/transacao.dto';
import { ReferenciaPendenteService } from '../../infraestrutura/workers/referencia-pendente.service';

describe('Processamento financeiro - PostgreSQL', () => {
  const carteiras = new CarteiraService();
  const transacoes = new TransacaoService();

  beforeAll(async () => { await banco.initialize(); });
  afterAll(async () => {
    if (banco.isInitialized) await banco.destroy();
  });

  async function preparar(saldo = '100.00') {
    const jogadorId = crypto.randomUUID();
    const carteira = await carteiras.abrir(jogadorId, {
      amount: saldo, currency: 'BRL'
    });
    const entrada: TransacaoDto = {
      providerId: 'provider-teste',
      externalTransactionId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      playerId: jogadorId,
      walletId: carteira.id,
      roundId: crypto.randomUUID(),
      gameId: 'game-1',
      kind: 'BET',
      money: { amount: '80.00', currency: 'BRL' }
    };
    return { carteira, entrada };
  }

  async function conferirSaldo(carteiraId: string, esperado: string) {
    const carteira = await carteiras.buscar(carteiraId);
    expect(carteira?.balance.toJSON().amount).toBe(esperado);
    const reconciliacao = await carteiras.reconciliar(carteiraId);
    expect(reconciliacao.consistent).toBe(true);
  }

  test('Deve abrir carteira com saldo inicial', async () => {
    const { carteira } = await preparar('1.00');
    await conferirSaldo(carteira.id, '1.00');
  });

  test('BET deve debitar saldo', async () => {
    const { carteira, entrada } = await preparar();
    const resultado = await transacoes.processar(entrada);
    expect(resultado.status).toBe('PROCESSED');
    await conferirSaldo(carteira.id, '20.00');
  });

  test('BET sem saldo deve ser rejeitado', async () => {
    const { carteira, entrada } = await preparar('1.00');
    const resultado = await transacoes.processar(entrada);
    expect(resultado.status).toBe('REJECTED');
    expect(resultado.failureCode).toBe('INSUFFICIENT_FUNDS');
    await conferirSaldo(carteira.id, '1.00');
  });

  test('WIN deve creditar saldo', async () => {
    const { carteira, entrada } = await preparar();
    const resultado = await transacoes.processar({ ...entrada, kind: 'WIN' });
    expect(resultado.status).toBe('PROCESSED');
    await conferirSaldo(carteira.id, '180.00');
  });

  test('LOSS nao deve alterar saldo', async () => {
    const { carteira, entrada } = await preparar();
    const resultado = await transacoes.processar({ ...entrada, kind: 'LOSS' });
    expect(resultado.status).toBe('PROCESSED');
    await conferirSaldo(carteira.id, '100.00');
    expect((await carteiras.reconciliar(carteira.id)).checkedEntries).toBe(1);
  });

  test('REFUND deve devolver valor da aposta', async () => {
    const { carteira, entrada } = await preparar();
    await transacoes.processar(entrada);
    const resultado = await transacoes.processar({
      ...entrada, kind: 'REFUND',
      externalTransactionId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      referenceExternalTransactionId: entrada.externalTransactionId
    });
    expect(resultado.status).toBe('PROCESSED');
    await conferirSaldo(carteira.id, '100.00');
  });

  test('ROLLBACK de BET deve devolver valor', async () => {
    const { carteira, entrada } = await preparar();
    await transacoes.processar(entrada);
    const resultado = await transacoes.processar({
      ...entrada, kind: 'ROLLBACK',
      externalTransactionId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      referenceExternalTransactionId: entrada.externalTransactionId
    });
    expect(resultado.status).toBe('PROCESSED');
    await conferirSaldo(carteira.id, '100.00');
  });

  test('Deve impedir debito duplicado', async () => {
    const { carteira, entrada } = await preparar();
    const primeiro = await transacoes.processar(entrada);
    const segundo = await transacoes.processar(entrada);
    expect(segundo.transactionId).toBe(primeiro.transactionId);
    expect(segundo.idempotentReplay).toBe(true);
    await conferirSaldo(carteira.id, '20.00');
  });

  test('Deve rejeitar payload divergente', async () => {
    const { carteira, entrada } = await preparar();
    await transacoes.processar(entrada);
    await expect(transacoes.processar({
      ...entrada, money: { amount: '10.00', currency: 'BRL' }
    })).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    await conferirSaldo(carteira.id, '20.00');
  });

  test('Duas apostas simultaneas nao devem gerar saldo negativo', async () => {
    const { carteira, entrada } = await preparar();
    const resultados = await Promise.all([
      transacoes.processar(entrada),
      transacoes.processar({ ...entrada,
        externalTransactionId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID()
      })
    ]);
    expect(resultados.filter(r => r.status === 'PROCESSED')).toHaveLength(1);
    expect(resultados.filter(r => r.status === 'REJECTED')).toHaveLength(1);
    expect(resultados.find(r => r.status === 'REJECTED')?.failureCode).toBe('INSUFFICIENT_FUNDS');
    await conferirSaldo(carteira.id, '20.00');
    expect((await carteiras.reconciliar(carteira.id)).checkedEntries).toBe(2);
  });

  test('50 requisicoes iguais devem gerar apenas um debito', async () => {
    const { carteira, entrada } = await preparar();
    const resultados = await Promise.all(Array.from({ length: 50 }, () => transacoes.processar(entrada)));
    expect(new Set(resultados.map(r => r.transactionId)).size).toBe(1);
    expect(resultados.filter(r => !r.idempotentReplay)).toHaveLength(1);
    await conferirSaldo(carteira.id, '20.00');
    expect((await carteiras.reconciliar(carteira.id)).checkedEntries).toBe(2);
  }, 30000);

  // Testes de referencias pendentes
  test('Deve reprocessar REFUND recebido antes do BET', async () => {
    const { carteira, entrada } = await preparar();
    const worker = new ReferenciaPendenteService(transacoes);
    const refund: TransacaoDto = {
      ...entrada, kind: 'REFUND',
      externalTransactionId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      referenceExternalTransactionId: entrada.externalTransactionId
    };
    const pendente = await transacoes.processar(refund);
    expect(pendente.status).toBe('PENDING_REFERENCE');
    await conferirSaldo(carteira.id, '100.00');
    expect((await transacoes.processar(entrada)).status).toBe('PROCESSED');
    await conferirSaldo(carteira.id, '20.00');
    await banco.manager.query(`UPDATE wager_transactions SET next_reference_attempt_at = NOW() WHERE id = $1`, [pendente.transactionId]);
    await worker.processarPendentes();
    const resultado = await transacoes.processar(refund);
    expect(resultado.status).toBe('PROCESSED');
    expect(resultado.idempotentReplay).toBe(true);
    await conferirSaldo(carteira.id, '100.00');
    expect((await carteiras.reconciliar(carteira.id)).checkedEntries).toBe(3);
  });

  test('Dois workers nao devem duplicar ROLLBACK pendente', async () => {
    const { carteira, entrada } = await preparar();
    const primeiroWorker = new ReferenciaPendenteService(transacoes);
    const segundoWorker = new ReferenciaPendenteService(transacoes);
    const rollback: TransacaoDto = {
      ...entrada, kind: 'ROLLBACK',
      externalTransactionId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      referenceExternalTransactionId: entrada.externalTransactionId
    };
    const pendente = await transacoes.processar(rollback);
    expect(pendente.status).toBe('PENDING_REFERENCE');
    await conferirSaldo(carteira.id, '100.00');
    expect((await transacoes.processar(entrada)).status).toBe('PROCESSED');
    await conferirSaldo(carteira.id, '20.00');
    await banco.manager.query(`UPDATE wager_transactions SET next_reference_attempt_at = NOW() WHERE id = $1`, [pendente.transactionId]);
    await Promise.all([primeiroWorker.processarPendentes(), segundoWorker.processarPendentes()]);
    const resultado = await transacoes.processar(rollback);
    expect(resultado.status).toBe('PROCESSED');
    expect(resultado.idempotentReplay).toBe(true);
    await conferirSaldo(carteira.id, '100.00');
    expect((await carteiras.reconciliar(carteira.id)).checkedEntries).toBe(3);
  });

  test('Deve rejeitar referencia expirada sem alterar saldo', async () => {
    const { carteira, entrada } = await preparar();
    const worker = new ReferenciaPendenteService(transacoes);
    const refund: TransacaoDto = {
      ...entrada, kind: 'REFUND',
      externalTransactionId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      referenceExternalTransactionId: crypto.randomUUID()
    };
    const pendente = await transacoes.processar(refund);
    expect(pendente.status).toBe('PENDING_REFERENCE');
    await conferirSaldo(carteira.id, '100.00');
    await banco.manager.query(`UPDATE wager_transactions SET reference_expires_at = NOW() - INTERVAL '1 second', next_reference_attempt_at = NOW() WHERE id = $1`, [pendente.transactionId]);
    await worker.processarPendentes();
    const resultado = await transacoes.processar(refund);
    expect(resultado.status).toBe('REJECTED');
    expect(resultado.failureCode).toBe('REFERENCE_NOT_FOUND');
    expect(resultado.idempotentReplay).toBe(true);
    await conferirSaldo(carteira.id, '100.00');
    expect((await carteiras.reconciliar(carteira.id)).checkedEntries).toBe(1);
  });
});
