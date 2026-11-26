import { describe, test, expect } from 'bun:test';
import { Money } from './money';

describe('Money', () => {
  test('Deve criar um valor monetario', () => {
    const dinheiro = Money.from({
      amount: '1',
      currency: 'BRL'
    });

    expect(dinheiro.toJSON()).toEqual({
      amount: '1.00',
      currency: 'BRL'
    });
  });

  test('Deve somar valores com precisao', () => {
    const primeiro = Money.from({
      amount: '0.10',
      currency: 'BRL'
    });

    const segundo = Money.from({
      amount: '0.20',
      currency: 'BRL'
    });

    expect(primeiro.add(segundo).toJSON().amount)
      .toBe('0.30');
  });

  test('Deve subtrair valores', () => {
    const saldo = Money.from({
      amount: '1.00',
      currency: 'BRL'
    });

    const aposta = Money.from({
      amount: '0.25',
      currency: 'BRL'
    });

    expect(saldo.subtract(aposta).toJSON().amount)
      .toBe('0.75');
  });

  test('Nao deve alterar o valor original', () => {
    const dinheiro = Money.from({
      amount: '1.00',
      currency: 'BRL'
    });

    dinheiro.add(dinheiro);

    expect(dinheiro.toJSON().amount).toBe('1.00');
  });

  test('Deve rejeitar valores invalidos', () => {
    const valoresInvalidos = [
      '1.999',
      'NaN',
      'Infinity',
      '1e3',
      '',
      'abc'
    ];

    for (const valor of valoresInvalidos) {
      expect(() => Money.from({
        amount: valor,
        currency: 'BRL'
      })).toThrow();
    }
  });

  test('Deve rejeitar conflito de moeda', () => {
    const real = Money.from({
      amount: '1.00',
      currency: 'BRL'
    });

    const dolar = Money.from({
      amount: '1.00',
      currency: 'USD'
    });

    expect(() => real.add(dolar)).toThrow();
  });

  test('Deve identificar valor zero', () => {
    expect(Money.zero('BRL').isZero()).toBe(true);
  });

  test('Deve inverter o sinal do valor', () => {
    const dinheiro = Money.from({
      amount: '1.00',
      currency: 'BRL'
    });

    expect(dinheiro.negate().toJSON().amount)
      .toBe('-1.00');
  });
});