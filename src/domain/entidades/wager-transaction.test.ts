import { describe, test, expect } from 'bun:test';
import { WagerTransaction } from './wager-transaction';
import { Money } from '../value-objects/money';
import { TipoTransacao } from '../enums/tipo-transacao';
import { StatusTransacao } from '../enums/status-transacao';
import { DirecaoLancamento } from '../enums/direcao-lancamento';
import { CodigoFalha } from '../enums/codigo-falha';

describe('WagerTransaction', () => {

  function criarTransacao(
    tipo: TipoTransacao,
    referencia?: string
  ): WagerTransaction {
    return WagerTransaction.create({
      providerId: 'provider-1',
      externalTransactionId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
      payloadHash: 'hash-teste',
      walletId: crypto.randomUUID(),
      playerId: crypto.randomUUID(),
      roundId: 'round-1',
      gameId: 'game-1',
      kind: tipo,
      money: Money.from({
        amount: '1.00',
        currency: 'BRL'
      }),
      referenceExternalTransactionId: referencia
    });
  }

  test('Deve iniciar como pendente', () => {
    const transacao = criarTransacao(TipoTransacao.BET);

    expect(transacao.status).toBe(StatusTransacao.PENDING);
  });

  test('BET deve gerar debito', () => {
    const transacao = criarTransacao(TipoTransacao.BET);

    expect(transacao.ledgerDirectionFor())
      .toBe(DirecaoLancamento.DEBIT);
  });

  test('WIN deve gerar credito', () => {
    const transacao = criarTransacao(TipoTransacao.WIN);

    expect(transacao.ledgerDirectionFor())
      .toBe(DirecaoLancamento.CREDIT);
  });

  test('LOSS nao deve alterar saldo', () => {
    const transacao = criarTransacao(TipoTransacao.LOSS);

    expect(transacao.affectsBalance()).toBe(false);
    expect(transacao.ledgerDirectionFor()).toBeNull();
  });

  test('REFUND deve gerar credito', () => {
    const transacao = criarTransacao(
      TipoTransacao.REFUND,
      'bet-1'
    );

    expect(transacao.ledgerDirectionFor())
      .toBe(DirecaoLancamento.CREDIT);
  });

  test('ROLLBACK de BET deve gerar credito', () => {
    const transacao = criarTransacao(
      TipoTransacao.ROLLBACK,
      'bet-1'
    );

    expect(transacao.ledgerDirectionFor(TipoTransacao.BET))
      .toBe(DirecaoLancamento.CREDIT);
  });

  test('ROLLBACK de WIN deve gerar debito', () => {
    const transacao = criarTransacao(
      TipoTransacao.ROLLBACK,
      'win-1'
    );

    expect(transacao.ledgerDirectionFor(TipoTransacao.WIN))
      .toBe(DirecaoLancamento.DEBIT);
  });

  test('REFUND exige referencia', () => {
    expect(() => criarTransacao(TipoTransacao.REFUND))
      .toThrow('REFERENCE_REQUIRED');
  });

  test('ROLLBACK exige referencia', () => {
    expect(() => criarTransacao(TipoTransacao.ROLLBACK))
      .toThrow('REFERENCE_REQUIRED');
  });

  test('Deve aguardar referencia ausente', () => {
    const transacao = criarTransacao(
      TipoTransacao.REFUND,
      'bet-1'
    );

    transacao.markPendingReference();

    expect(transacao.status)
      .toBe(StatusTransacao.PENDING_REFERENCE);
  });

  test('Deve finalizar transacao processada', () => {
    const transacao = criarTransacao(TipoTransacao.BET);

    transacao.markProcessed();

    expect(transacao.status).toBe(StatusTransacao.PROCESSED);
    expect(transacao.isTerminal()).toBe(true);
  });

  test('Nao deve alterar transacao finalizada', () => {
    const transacao = criarTransacao(TipoTransacao.BET);

    transacao.markProcessed();

    expect(() => transacao.markProcessed()).toThrow();
  });

  test('Deve rejeitar transacao', () => {
    const transacao = criarTransacao(TipoTransacao.BET);

    transacao.reject(CodigoFalha.SALDO_INSUFICIENTE);

    expect(transacao.status).toBe(StatusTransacao.REJECTED);
    expect(transacao.failureCode)
      .toBe(CodigoFalha.SALDO_INSUFICIENTE);
  });

  test('Deve identificar payload divergente', () => {
    const transacao = criarTransacao(TipoTransacao.BET);

    expect(transacao.matchesPayload('hash-teste')).toBe(true);
    expect(transacao.matchesPayload('outro-hash')).toBe(false);
  });

});