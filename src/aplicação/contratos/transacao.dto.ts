import type { MoneyProps } from '../../domain/value-objects/money';

export type TipoTransacaoExterna =
  | 'BET'
  | 'WIN'
  | 'LOSS'
  | 'REFUND'
  | 'ROLLBACK';

export interface TransacaoDto {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: TipoTransacaoExterna;
  money: MoneyProps;
  referenceExternalTransactionId?: string;
}

export interface ResultadoTransacao {
  transactionId: string;
  status: string;
  balance: MoneyProps | null;
  idempotentReplay: boolean;
  failureCode?: string;
}