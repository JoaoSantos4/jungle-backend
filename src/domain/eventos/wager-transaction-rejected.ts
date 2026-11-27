import { IntegrationEvent } from './integration-event';
import type { EventContext } from './integration-event';
import { WagerTransaction } from '../entidades/wager-transaction';
import { StatusTransacao } from '../enums/status-transacao';
import type { CodigoFalha } from '../enums/codigo-falha';

export interface WagerTransactionRejectedData {
  transactionId: string;
  walletId: string;
  providerId: string;
  externalTransactionId: string;
  failureCode: CodigoFalha;
}

export class WagerTransactionRejected
  extends IntegrationEvent<WagerTransactionRejectedData> {

  readonly eventType = 'WagerTransactionRejected';
  readonly version = 1;

  static from(
    transacao: WagerTransaction,
    contexto: EventContext
  ): WagerTransactionRejected {

    const dados = transacao.toProps();

    if (
      dados.status !== StatusTransacao.REJECTED ||
      !dados.failureCode
    ) {
      throw new Error('Transacao nao rejeitada');
    }

    return new WagerTransactionRejected({
      eventId: crypto.randomUUID(),
      aggregateId: dados.id,
      ...contexto,
      occurredAt: new Date(),
      data: {
        transactionId: dados.id,
        walletId: dados.walletId,
        providerId: dados.providerId,
        externalTransactionId: dados.externalTransactionId,
        failureCode: dados.failureCode
      }
    });
  }
}