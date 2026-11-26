import { Money } from '../value-objects/money';

export interface WalletProps {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export class Wallet {
  private constructor(
    private readonly identificador: string,
    private readonly jogadorId: string,
    private readonly moeda: string,
    private saldo: Money,
    private versao: number,
    private readonly dataCriacao: Date,
    private dataAtualizacao: Date
  ) {}

  static open(playerId: string, currency: string): Wallet {
    const agora = new Date();

    return new Wallet(
      crypto.randomUUID(),
      playerId,
      currency,
      Money.zero(currency),
      1,
      agora,
      agora
    );
  }

  static rehydrate(props: WalletProps): Wallet {
    return new Wallet(
      props.id,
      props.playerId,
      props.currency,
      props.balance,
      props.version,
      props.createdAt,
      props.updatedAt
    );
  }

  debit(valor: Money): void {
    this.saldo.assertSameCurrency(valor);

    if (!valor.isPositive()) {
      throw new Error('Valor do debito invalido');
    }

    if (this.saldo.isLessThan(valor)) {
      throw new Error('INSUFFICIENT_FUNDS');
    }

    this.saldo = this.saldo.subtract(valor);
    this.versao++;
    this.dataAtualizacao = new Date();
  }

  credit(valor: Money): void {
    this.saldo.assertSameCurrency(valor);

    if (!valor.isPositive()) {
      throw new Error('Valor do credito invalido');
    }

    this.saldo = this.saldo.add(valor);
    this.versao++;
    this.dataAtualizacao = new Date();
  }

  get id(): string {
    return this.identificador;
  }

  get playerId(): string {
    return this.jogadorId;
  }

  get currency(): string {
    return this.moeda;
  }

  get balance(): Money {
    return this.saldo;
  }

  get version(): number {
    return this.versao;
  }

  get createdAt(): Date {
    return new Date(this.dataCriacao);
  }

  get updatedAt(): Date {
    return new Date(this.dataAtualizacao);
  }
}