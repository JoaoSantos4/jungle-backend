import { IntegrationEvent } from './integration-event';
import type { EventContext } from './integration-event';
import type { MoneyProps } from '../value-objects/money';
import { WagerTransaction } from '../entidades/wager-transaction';
import { StatusTransacao } from '../enums/status-transacao';
import { TipoTransacao } from '../enums/tipo-transacao';

export interface WagerTransactionProcessedData {
  transactionId: string;
  walletId: string;
  providerId: string;
  externalTransactionId: string;
  kind: string;
  money: MoneyProps;
}

export class WagerTransactionProcessed
  extends IntegrationEvent<WagerTransactionProcessedData> {

  readonly eventType = 'WagerTransactionProcessed';
  readonly version = 1;

  static from(
    transacao: WagerTransaction,
    contexto: EventContext
  ): WagerTransactionProcessed {

    const dados = transacao.toProps();

    if (dados.status !== StatusTransacao.PROCESSED) {
      throw new Error('Transacao nao processada');
    }

    return new WagerTransactionProcessed({
      eventId: crypto.randomUUID(),
      aggregateId: dados.id,
      ...contexto,
      occurredAt: new Date(),
      data: {
        transactionId: dados.id,
        walletId: dados.walletId,
        providerId: dados.providerId,
        externalTransactionId: dados.externalTransactionId,
        kind: TipoTransacao[dados.kind]!,
        money: dados.money.toJSON()
      }
    });
  }
}