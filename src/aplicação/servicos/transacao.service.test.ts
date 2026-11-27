import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll
} from 'bun:test';

import { banco } from '../../infraestrutura/banco/data-source';

import { CarteiraService } from './carteira.service';
import { TransacaoService } from './transacao.service';

import type {
  TransacaoDto
} from '../contratos/transacao.dto';

describe('Processamento financeiro - PostgreSQL', () => {

  const carteiras = new CarteiraService();
  const transacoes = new TransacaoService();

  beforeAll(async () => {
    await banco.initialize();
  });

  afterAll(async () => {
    if (banco.isInitialized) {
      await banco.destroy();
    }
  });

  async function preparar(saldo = '100.00') {

    const jogadorId = crypto.randomUUID();

    const carteira = await carteiras.abrir(
      jogadorId,
      {
        amount: saldo,
        currency: 'BRL'
      }
    );

    const entrada: TransacaoDto = {
      providerId: 'provider-teste',
      externalTransactionId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      playerId: jogadorId,
      walletId: carteira.id,
      roundId: crypto.randomUUID(),
      gameId: 'game-1',
      kind: 'BET',
      money: {
        amount: '80.00',
        currency: 'BRL'
      }
    };

    return { carteira, entrada };
  }

  async function conferirSaldo(
    carteiraId: string,
    esperado: string
  ) {

    const carteira = await carteiras.buscar(carteiraId);

    expect(carteira?.balance.toJSON().amount)
      .toBe(esperado);

    const reconciliacao = await carteiras.reconciliar(
      carteiraId
    );

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

    expect(resultado.failureCode)
      .toBe('INSUFFICIENT_FUNDS');

    await conferirSaldo(carteira.id, '1.00');
  });

  test('WIN deve creditar saldo', async () => {

    const { carteira, entrada } = await preparar();

    const resultado = await transacoes.processar({
      ...entrada,
      kind: 'WIN'
    });

    expect(resultado.status).toBe('PROCESSED');

    await conferirSaldo(carteira.id, '180.00');
  });

  test('LOSS nao deve alterar saldo', async () => {

    const { carteira, entrada } = await preparar();

    const resultado = await transacoes.processar({
      ...entrada,
      kind: 'LOSS'
    });

    expect(resultado.status).toBe('PROCESSED');

    await conferirSaldo(carteira.id, '100.00');

    const reconciliacao = await carteiras.reconciliar(
      carteira.id
    );

    expect(reconciliacao.checkedEntries).toBe(1);
  });

  test('REFUND deve devolver valor da aposta', async () => {

    const { carteira, entrada } = await preparar();

    await transacoes.processar(entrada);

    const resultado = await transacoes.processar({
      ...entrada,
      kind: 'REFUND',
      externalTransactionId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      referenceExternalTransactionId:
        entrada.externalTransactionId
    });

    expect(resultado.status).toBe('PROCESSED');

    await conferirSaldo(carteira.id, '100.00');
  });

  test('ROLLBACK de BET deve devolver valor', async () => {

    const { carteira, entrada } = await preparar();

    await transacoes.processar(entrada);

    const resultado = await transacoes.processar({
      ...entrada,
      kind: 'ROLLBACK',
      externalTransactionId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      referenceExternalTransactionId:
        entrada.externalTransactionId
    });

    expect(resultado.status).toBe('PROCESSED');

    await conferirSaldo(carteira.id, '100.00');
  });

  test('Deve impedir debito duplicado', async () => {

    const { carteira, entrada } = await preparar();

    const primeiro = await transacoes.processar(entrada);
    const segundo = await transacoes.processar(entrada);

    expect(segundo.transactionId)
      .toBe(primeiro.transactionId);

    expect(segundo.idempotentReplay).toBe(true);

    await conferirSaldo(carteira.id, '20.00');
  });

  test('Deve rejeitar payload divergente', async () => {

    const { carteira, entrada } = await preparar();

    await transacoes.processar(entrada);

    await expect(
      transacoes.processar({
        ...entrada,
        money: {
          amount: '10.00',
          currency: 'BRL'
        }
      })
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');

    await conferirSaldo(carteira.id, '20.00');
  });

  test('Duas apostas simultaneas nao devem gerar saldo negativo', async () => {

    const { carteira, entrada } = await preparar();

    const resultados = await Promise.all([
      transacoes.processar(entrada),

      transacoes.processar({
        ...entrada,
        externalTransactionId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID()
      })
    ]);

    expect(
      resultados.filter(r => r.status === 'PROCESSED')
    ).toHaveLength(1);

    expect(
      resultados.filter(r => r.status === 'REJECTED')
    ).toHaveLength(1);

    expect(
      resultados.find(r => r.status === 'REJECTED')?.failureCode
    ).toBe('INSUFFICIENT_FUNDS');

    await conferirSaldo(carteira.id, '20.00');

    const reconciliacao = await carteiras.reconciliar(
      carteira.id
    );

    expect(reconciliacao.checkedEntries).toBe(2);
  });

  test('50 requisicoes iguais devem gerar apenas um debito', async () => {

    const { carteira, entrada } = await preparar();

    const resultados = await Promise.all(
      Array.from(
        { length: 50 },
        () => transacoes.processar(entrada)
      )
    );

    const identificadores = new Set(
      resultados.map(r => r.transactionId)
    );

    expect(identificadores.size).toBe(1);

    expect(
      resultados.filter(r => !r.idempotentReplay)
    ).toHaveLength(1);

    await conferirSaldo(carteira.id, '20.00');

    const reconciliacao = await carteiras.reconciliar(
      carteira.id
    );

    expect(reconciliacao.checkedEntries).toBe(2);
  }, 30000);

});