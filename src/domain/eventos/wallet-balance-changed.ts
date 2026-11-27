import { IntegrationEvent } from './integration-event';
import type { EventContext } from './integration-event';
import type { MoneyProps } from '../value-objects/money';
import { Wallet } from '../entidades/wallet';
import { WalletLedgerEntry } from '../entidades/wallet-ledger-entry';
import { DirecaoLancamento } from '../enums/direcao-lancamento';

export interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  direction: string;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}

export class WalletBalanceChanged
  extends IntegrationEvent<WalletBalanceChangedData> {

  readonly eventType = 'WalletBalanceChanged';
  readonly version = 1;

  static from(
    carteira: Wallet,
    lancamento: WalletLedgerEntry,
    contexto: EventContext
  ): WalletBalanceChanged {

    if (carteira.id !== lancamento.walletId) {
      throw new Error('Lancamento de outra carteira');
    }

    if (!carteira.balance.equals(lancamento.balanceAfter)) {
      throw new Error('Saldo da carteira divergente');
    }

    return new WalletBalanceChanged({
      eventId: crypto.randomUUID(),
      aggregateId: carteira.id,
      ...contexto,
      occurredAt: new Date(),
      data: {
        walletId: carteira.id,
        transactionId: lancamento.transactionId,
        direction: DirecaoLancamento[lancamento.direction]!,
        money: lancamento.money.toJSON(),
        balanceBefore: lancamento.balanceBefore.toJSON(),
        balanceAfter: lancamento.balanceAfter.toJSON(),
        walletVersion: carteira.version
      }
    });
  }
}