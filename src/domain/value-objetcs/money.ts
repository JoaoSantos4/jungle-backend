import Decimal from 'decimal.js';

export interface MoneyProps {
  amount: string;
  currency: string;
}

export class Money {
  private constructor(
    private readonly valor: Decimal,
    private readonly moeda: string
  ) {}

  static from(props: MoneyProps): Money {
    if (
      typeof props.amount !== 'string' ||
      !/^-?\d+(\.\d{1,2})?$/.test(props.amount)
    ) {
      throw new Error('Valor monetario invalido');
    }

    if (
      typeof props.currency !== 'string' ||
      !/^[A-Z]{3}$/.test(props.currency)
    ) {
      throw new Error('Moeda invalida');
    }

    const valor = new Decimal(props.amount);

    if (!valor.isFinite()) {
      throw new Error('Valor monetario invalido');
    }

    return new Money(valor, props.currency);
  }

  static zero(moeda: string): Money {
    return Money.from({
      amount: '0.00',
      currency: moeda
    });
  }

  add(outro: Money): Money {
    this.assertSameCurrency(outro);

    return new Money(
      this.valor.plus(outro.valor),
      this.moeda
    );
  }

  subtract(outro: Money): Money {
    this.assertSameCurrency(outro);

    return new Money(
      this.valor.minus(outro.valor),
      this.moeda
    );
  }

  negate(): Money {
    return new Money(
      this.valor.negated(),
      this.moeda
    );
  }

  isZero(): boolean {
    return this.valor.isZero();
  }

  isPositive(): boolean {
    return this.valor.gt(0);
  }

  isNegative(): boolean {
    return this.valor.lt(0);
  }

  isLessThan(outro: Money): boolean {
    this.assertSameCurrency(outro);

    return this.valor.lt(outro.valor);
  }

  equals(outro: Money): boolean {
    return (
      this.moeda === outro.moeda &&
      this.valor.equals(outro.valor)
    );
  }

  assertSameCurrency(outro: Money): void {
    if (this.moeda !== outro.moeda) {
      throw new Error('Conflito de moeda');
    }
  }

  toJSON(): MoneyProps {
    return {
      amount: this.valor.toFixed(2),
      currency: this.moeda
    };
  }

  toString(): string {
    return `${this.valor.toFixed(2)} ${this.moeda}`;
  }
}