import { describe, test, expect } from 'bun:test';
import { Wallet } from './wallet';
import { Money } from '../value-objects/money';

describe('Wallet', () => {

  function criarCarteira(): Wallet {
    return Wallet.open(crypto.randomUUID(), 'BRL');
  }

  function dinheiro(valor: string): Money {
    return Money.from({
      amount: valor,
      currency: 'BRL'
    });
  }

  test('Deve criar carteira com saldo zero', () => {
    const carteira = criarCarteira();

    expect(carteira.balance.isZero()).toBe(true);
    expect(carteira.version).toBe(1);
  });

  test('Deve creditar saldo', () => {
    const carteira = criarCarteira();

    carteira.credit(dinheiro('1.00'));

    expect(carteira.balance.toJSON().amount)
      .toBe('1.00');

    expect(carteira.version).toBe(2);
  });

  test('Deve debitar saldo', () => {
    const carteira = criarCarteira();

    carteira.credit(dinheiro('1.00'));
    carteira.debit(dinheiro('0.25'));

    expect(carteira.balance.toJSON().amount)
      .toBe('0.75');

    expect(carteira.version).toBe(3);
  });

  test('Nao deve permitir saldo negativo', () => {
    const carteira = criarCarteira();

    carteira.credit(dinheiro('1.00'));

    expect(() => carteira.debit(dinheiro('2.00')))
      .toThrow('INSUFFICIENT_FUNDS');

    expect(carteira.balance.toJSON().amount)
      .toBe('1.00');

    expect(carteira.version).toBe(2);
  });

  test('Deve permitir utilizar todo o saldo', () => {
    const carteira = criarCarteira();

    carteira.credit(dinheiro('1.00'));
    carteira.debit(dinheiro('1.00'));

    expect(carteira.balance.isZero()).toBe(true);
  });

  test('Nao deve aceitar moedas diferentes', () => {
    const carteira = criarCarteira();

    const dolar = Money.from({
      amount: '1.00',
      currency: 'USD'
    });

    expect(() => carteira.credit(dolar)).toThrow();
    expect(() => carteira.debit(dolar)).toThrow();

    expect(carteira.balance.isZero()).toBe(true);
    expect(carteira.version).toBe(1);
  });

  test('Nao deve aceitar credito negativo', () => {
    const carteira = criarCarteira();

    expect(() => carteira.credit(dinheiro('-1.00')))
      .toThrow();
  });

  test('Nao deve aceitar debito negativo', () => {
    const carteira = criarCarteira();

    expect(() => carteira.debit(dinheiro('-1.00')))
      .toThrow();
  });

  test('Nao deve aceitar movimentacao de valor zero', () => {
    const carteira = criarCarteira();

    expect(() => carteira.credit(dinheiro('0.00')))
      .toThrow();

    expect(() => carteira.debit(dinheiro('0.00')))
      .toThrow();

    expect(carteira.version).toBe(1);
  });

  test('Deve reconstruir uma carteira persistida', () => {
    const agora = new Date();

    const carteira = Wallet.rehydrate({
      id: crypto.randomUUID(),
      playerId: crypto.randomUUID(),
      currency: 'BRL',
      balance: dinheiro('1.00'),
      version: 5,
      createdAt: agora,
      updatedAt: agora
    });

    expect(carteira.balance.toJSON().amount)
      .toBe('1.00');

    expect(carteira.version).toBe(5);
  });

});