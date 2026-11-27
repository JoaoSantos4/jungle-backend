import { describe, test, expect } from 'bun:test';
import { Money } from '../value-objects/money';
import { Wallet } from '../entidades/wallet';
import { WagerTransaction } from '../entidades/wager-transaction';
import { WalletLedgerEntry } from '../entidades/wallet-ledger-entry';
import { OutboxMessage } from '../entidades/outbox-message';

import { TipoTransacao } from '../enums/tipo-transacao';
import { DirecaoLancamento } from '../enums/direcao-lancamento';
import { CodigoFalha } from '../enums/codigo-falha';

import { WagerTransactionProcessed } from './wager-transaction-processed';
import { WagerTransactionRejected } from './wager-transaction-rejected';
import { WagerTransactionPendingReference } from './wager-transaction-pending-reference';
import { WalletBalanceChanged } from './wallet-balance-changed';

describe('Eventos de integracao', () => {

  const contexto = {
    correlationId: 'correlation-1',
    causationId: 'message-1'
  };

  const valor = Money.from({
    amount: '1.00',
    currency: 'BRL'
  });

  function criarTransacao(
    tipo = TipoTransacao.BET,
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
      money: valor,
      referenceExternalTransactionId: referencia
    });
  }

  function criarEventoProcessado() {
    const transacao = criarTransacao();

    transacao.markProcessed();

    return WagerTransactionProcessed.from(
      transacao,
      contexto
    );
  }

  function criarEventoSaldo() {
    const carteira = Wallet.open(
      crypto.randomUUID(),
      'BRL'
    );

    const saldoAnterior = carteira.balance;

    carteira.credit(valor);

    const lancamento = WalletLedgerEntry.create({
      walletId: carteira.id,
      transactionId: crypto.randomUUID(),
      direction: DirecaoLancamento.CREDIT,
      money: valor,
      balanceBefore: saldoAnterior,
      balanceAfter: carteira.balance
    });

    return WalletBalanceChanged.from(
      carteira,
      lancamento,
      contexto
    );
  }

  test('Deve gerar evento de transacao processada', () => {
    const evento = criarEventoProcessado();

    expect(evento.eventType)
      .toBe('WagerTransactionProcessed');

    expect(evento.data.kind).toBe('BET');
    expect(evento.data.money.amount).toBe('1.00');
  });

  test('Deve gerar evento de transacao rejeitada', () => {
    const transacao = criarTransacao();

    transacao.reject(CodigoFalha.SALDO_INSUFICIENTE);

    const evento = WagerTransactionRejected.from(
      transacao,
      contexto
    );

    expect(evento.eventType)
      .toBe('WagerTransactionRejected');

    expect(evento.data.failureCode)
      .toBe(CodigoFalha.SALDO_INSUFICIENTE);
  });

  test('Deve gerar evento de referencia pendente', () => {
    const transacao = criarTransacao(
      TipoTransacao.REFUND,
      'bet-1'
    );

    transacao.markPendingReference();

    const evento = WagerTransactionPendingReference.from(
      transacao,
      contexto
    );

    expect(evento.eventType)
      .toBe('WagerTransactionPendingReference');

    expect(evento.data.referenceExternalTransactionId)
      .toBe('bet-1');
  });

  test('Deve gerar evento de saldo alterado', () => {
    const evento = criarEventoSaldo();

    expect(evento.eventType)
      .toBe('WalletBalanceChanged');

    expect(evento.data.balanceBefore.amount).toBe('0.00');
    expect(evento.data.balanceAfter.amount).toBe('1.00');
    expect(evento.data.direction).toBe('CREDIT');
    expect(evento.data.walletVersion).toBe(2);
  });

  test('Deve serializar envelope do evento', () => {
    const evento = criarEventoProcessado();
    const json = evento.toJSON();

    expect(json.eventId).toBe(evento.eventId);
    expect(json.version).toBe(1);
    expect(json.correlationId).toBe('correlation-1');
    expect(json.causationId).toBe('message-1');
    expect(json.occurredAt)
      .toBe(evento.occurredAt.toISOString());
  });

  test('Nao deve gerar evento processado para pendente', () => {
    const transacao = criarTransacao();

    expect(() => WagerTransactionProcessed.from(
      transacao,
      contexto
    )).toThrow('Transacao nao processada');
  });

  test('Nao deve permitir alterar dados originais', () => {
    const evento = criarEventoProcessado();

    const dados = evento.data;

    dados.money.amount = '999.00';

    expect(evento.data.money.amount).toBe('1.00');
  });

  test('Deve registrar evento no outbox', () => {
    const evento = criarEventoProcessado();

    const mensagem = OutboxMessage.enqueue({
      id: evento.eventId,
      aggregateId: evento.aggregateId,
      eventType: evento.eventType,
      occurredAt: evento.occurredAt,
      payload: evento.toJSON()
    });

    expect(mensagem.id).toBe(evento.eventId);
    expect(mensagem.isPending()).toBe(true);
    expect(mensagem.payload).toEqual(evento.toJSON());
  });

});