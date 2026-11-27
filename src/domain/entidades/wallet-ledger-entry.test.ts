import { describe, test, expect } from 'bun:test';
import { WalletLedgerEntry } from './wallet-ledger-entry';
import { Money } from '../value-objects/money';
import { DirecaoLancamento } from '../enums/direcao-lancamento';

describe('WalletLedgerEntry', () => {

  function criarMoney(
    valor: string,
    moeda = 'BRL'
  ): Money {
    return Money.from({
      amount: valor,
      currency: moeda
    });
  }

  function criarLancamento(
    direcao: DirecaoLancamento,
    valor: string,
    anterior: string,
    posterior: string
  ): WalletLedgerEntry {
    return WalletLedgerEntry.create({
      walletId: crypto.randomUUID(),
      transactionId: crypto.randomUUID(),
      direction: direcao,
      money: criarMoney(valor),
      balanceBefore: criarMoney(anterior),
      balanceAfter: criarMoney(posterior)
    });
  }

  test('Deve criar lancamento de credito', () => {
    const lancamento = criarLancamento(
      DirecaoLancamento.CREDIT,
      '1.00',
      '0.00',
      '1.00'
    );

    expect(lancamento.balanceAfter.toJSON().amount)
      .toBe('1.00');
  });

  test('Deve criar lancamento de debito', () => {
    const lancamento = criarLancamento(
      DirecaoLancamento.DEBIT,
      '0.30',
      '1.00',
      '0.70'
    );

    expect(lancamento.balanceAfter.toJSON().amount)
      .toBe('0.70');
  });

  test('Deve permitir debito total do saldo', () => {
    const lancamento = criarLancamento(
      DirecaoLancamento.DEBIT,
      '1.00',
      '1.00',
      '0.00'
    );

    expect(lancamento.balanceAfter.isZero()).toBe(true);
  });

  test('Nao deve permitir credito inconsistente', () => {
    expect(() => criarLancamento(
      DirecaoLancamento.CREDIT,
      '1.00',
      '1.00',
      '3.00'
    )).toThrow('Inconsistencia no lancamento');
  });

  test('Nao deve permitir debito inconsistente', () => {
    expect(() => criarLancamento(
      DirecaoLancamento.DEBIT,
      '0.30',
      '1.00',
      '0.90'
    )).toThrow('Inconsistencia no lancamento');
  });

  test('Nao deve permitir saldo negativo', () => {
    expect(() => criarLancamento(
      DirecaoLancamento.DEBIT,
      '2.00',
      '1.00',
      '-1.00'
    )).toThrow('Saldo negativo no lancamento');
  });

  test('Nao deve permitir valor negativo', () => {
    expect(() => criarLancamento(
      DirecaoLancamento.CREDIT,
      '-1.00',
      '1.00',
      '0.00'
    )).toThrow('Valor do lancamento invalido');
  });

  test('Nao deve permitir valor zero', () => {
    expect(() => criarLancamento(
      DirecaoLancamento.CREDIT,
      '0.00',
      '1.00',
      '1.00'
    )).toThrow('Valor do lancamento invalido');
  });

  test('Nao deve permitir moedas diferentes', () => {
    expect(() => WalletLedgerEntry.create({
      walletId: crypto.randomUUID(),
      transactionId: crypto.randomUUID(),
      direction: DirecaoLancamento.CREDIT,
      money: criarMoney('1.00', 'USD'),
      balanceBefore: criarMoney('0.00'),
      balanceAfter: criarMoney('1.00')
    })).toThrow('Conflito de moeda');
  });

  test('Deve reconstruir lancamento persistido', () => {
    const original = criarLancamento(
      DirecaoLancamento.CREDIT,
      '1.00',
      '0.00',
      '1.00'
    );

    const reconstruido = WalletLedgerEntry.rehydrate(
      original.toProps()
    );

    expect(reconstruido.id).toBe(original.id);

    expect(
      reconstruido.balanceAfter.equals(original.balanceAfter)
    ).toBe(true);

    expect(reconstruido.createdAt.getTime())
      .toBe(original.createdAt.getTime());
  });

  test('Nao deve permitir alterar data original', () => {
    const lancamento = criarLancamento(
      DirecaoLancamento.CREDIT,
      '1.00',
      '0.00',
      '1.00'
    );

    const dataOriginal = lancamento.createdAt.getTime();

    lancamento.createdAt.setFullYear(2000);

    expect(lancamento.createdAt.getTime())
      .toBe(dataOriginal);
  });

});