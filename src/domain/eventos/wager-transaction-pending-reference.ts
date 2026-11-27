import { IntegrationEvent } from './integration-event';
import type { EventContext } from './integration-event';
import { WagerTransaction } from '../entidades/wager-transaction';
import { StatusTransacao } from '../enums/status-transacao';

export interface WagerTransactionPendingReferenceData {
  transactionId: string;
  walletId: string;
  providerId: string;
  externalTransactionId: string;
  referenceExternalTransactionId: string;
}

export class WagerTransactionPendingReference
  extends IntegrationEvent<WagerTransactionPendingReferenceData> {

  readonly eventType = 'WagerTransactionPendingReference';
  readonly version = 1;

  static from(
    transacao: WagerTransaction,
    contexto: EventContext
  ): WagerTransactionPendingReference {

    const dados = transacao.toProps();

    if (
      dados.status !== StatusTransacao.PENDING_REFERENCE ||
      !dados.referenceExternalTransactionId
    ) {
      throw new Error('Transacao nao aguarda referencia');
    }

    return new WagerTransactionPendingReference({
      eventId: crypto.randomUUID(),
      aggregateId: dados.id,
      ...contexto,
      occurredAt: new Date(),
      data: {
        transactionId: dados.id,
        walletId: dados.walletId,
        providerId: dados.providerId,
        externalTransactionId: dados.externalTransactionId,
        referenceExternalTransactionId:
          dados.referenceExternalTransactionId
      }
    });
  }
}