import { Money } from '../value-objects/money';
import { DirecaoLancamento } from '../enums/direcao-lancamento';

export interface WalletLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: DirecaoLancamento;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

export type CriarLancamentoProps = Omit<
  WalletLedgerEntryProps,
  'id' | 'createdAt'
>;

export class WalletLedgerEntry {
  private constructor(
    private readonly dados: Readonly<WalletLedgerEntryProps>
  ) {}

  static create(
    props: CriarLancamentoProps
  ): WalletLedgerEntry {

    const {
      money: valor,
      balanceBefore: saldoAnterior,
      balanceAfter: saldoPosterior,
      direction: direcao
    } = props;

    saldoAnterior.assertSameCurrency(valor);
    saldoPosterior.assertSameCurrency(valor);

    if (!valor.isPositive()) {
      throw new Error('Valor do lancamento invalido');
    }

    if (
      saldoAnterior.isNegative() ||
      saldoPosterior.isNegative()
    ) {
      throw new Error('Saldo negativo no lancamento');
    }

    let saldoEsperado: Money;

    switch (direcao) {
      case DirecaoLancamento.DEBIT:
        saldoEsperado = saldoAnterior.subtract(valor);
        break;

      case DirecaoLancamento.CREDIT:
        saldoEsperado = saldoAnterior.add(valor);
        break;

      default:
        throw new Error('Direcao do lancamento invalida');
    }

    if (!saldoEsperado.equals(saldoPosterior)) {
      throw new Error('Inconsistencia no lancamento');
    }

    return new WalletLedgerEntry({
      ...props,
      id: crypto.randomUUID(),
      createdAt: new Date()
    });
  }

  static rehydrate(
    props: WalletLedgerEntryProps
  ): WalletLedgerEntry {
    return new WalletLedgerEntry({
      ...props,
      createdAt: new Date(props.createdAt)
    });
  }

  get id(): string {
    return this.dados.id;
  }

  get walletId(): string {
    return this.dados.walletId;
  }

  get transactionId(): string {
    return this.dados.transactionId;
  }

  get direction(): DirecaoLancamento {
    return this.dados.direction;
  }

  get money(): Money {
    return this.dados.money;
  }

  get balanceBefore(): Money {
    return this.dados.balanceBefore;
  }

  get balanceAfter(): Money {
    return this.dados.balanceAfter;
  }

  get createdAt(): Date {
    return new Date(this.dados.createdAt);
  }

  toProps(): WalletLedgerEntryProps {
    return {
      ...this.dados,
      createdAt: new Date(this.dados.createdAt)
    };
  }
}