import { Money } from '../value-objects/money';
import { StatusTransacao } from '../enums/status-transacao';
import { TipoTransacao } from '../enums/tipo-transacao';
import { DirecaoLancamento } from '../enums/direcao-lancamento';
import type { CodigoFalha } from '../enums/codigo-falha';

export interface WagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: TipoTransacao;
  money: Money;
  referenceExternalTransactionId?: string;
  referenceTransactionId?: string;
  status: StatusTransacao;
  failureCode?: CodigoFalha;
  createdAt: Date;
  processedAt?: Date;
}

export type CriarTransacaoProps = Omit<
  WagerTransactionProps,
  'id' | 'status' | 'createdAt' | 'processedAt' |
  'failureCode' | 'referenceTransactionId'
>;

export class WagerTransaction {
  private constructor(
    private readonly dados: WagerTransactionProps
  ) {}

  static create(props: CriarTransacaoProps): WagerTransaction {
    if (
      (props.kind === TipoTransacao.REFUND ||
       props.kind === TipoTransacao.ROLLBACK) &&
      !props.referenceExternalTransactionId
    ) {
      throw new Error('REFERENCE_REQUIRED');
    }

    if (props.money.isNegative()) {
      throw new Error('Valor da transacao invalido');
    }

    if (
      props.kind !== TipoTransacao.LOSS &&
      !props.money.isPositive()
    ) {
      throw new Error('Valor da transacao deve ser positivo');
    }

    return new WagerTransaction({
      ...props,
      id: crypto.randomUUID(),
      status: StatusTransacao.PENDING,
      createdAt: new Date()
    });
  }

  static rehydrate(
    props: WagerTransactionProps
  ): WagerTransaction {
    return new WagerTransaction({ ...props });
  }

  isTerminal(): boolean {
    return (
      this.dados.status === StatusTransacao.PROCESSED ||
      this.dados.status === StatusTransacao.REJECTED ||
      this.dados.status === StatusTransacao.FAILED
    );
  }

  private validarTransicao(): void {
    if (this.isTerminal()) {
      throw new Error('Transacao ja finalizada');
    }
  }

  markProcessed(referenceTransactionId?: string): void {
    this.validarTransicao();

    this.dados.status = StatusTransacao.PROCESSED;
    this.dados.referenceTransactionId = referenceTransactionId;
    this.dados.failureCode = undefined;
    this.dados.processedAt = new Date();
  }

  markPendingReference(): void {
    this.validarTransicao();

    if (!this.requiresReference()) {
      throw new Error('Transacao nao exige referencia');
    }

    this.dados.status = StatusTransacao.PENDING_REFERENCE;
  }

  reject(codigo: CodigoFalha): void {
    this.validarTransicao();

    this.dados.status = StatusTransacao.REJECTED;
    this.dados.failureCode = codigo;
    this.dados.processedAt = new Date();
  }

  fail(codigo: CodigoFalha): void {
    this.validarTransicao();

    this.dados.status = StatusTransacao.FAILED;
    this.dados.failureCode = codigo;
    this.dados.processedAt = new Date();
  }

  affectsBalance(): boolean {
    return this.dados.kind !== TipoTransacao.LOSS;
  }

  requiresReference(): boolean {
    return (
      this.dados.kind === TipoTransacao.REFUND ||
      this.dados.kind === TipoTransacao.ROLLBACK
    );
  }

  matchesPayload(hash: string): boolean {
    return this.dados.payloadHash === hash;
  }

  ledgerDirectionFor(
    tipoReferencia?: TipoTransacao
  ): DirecaoLancamento | null {
    switch (this.dados.kind) {
      case TipoTransacao.BET:
        return DirecaoLancamento.DEBIT;

      case TipoTransacao.OPENING:
      case TipoTransacao.WIN:
      case TipoTransacao.REFUND:
        return DirecaoLancamento.CREDIT;

      case TipoTransacao.LOSS:
        return null;

      case TipoTransacao.ROLLBACK:
        switch (tipoReferencia) {
          case TipoTransacao.BET:
            return DirecaoLancamento.CREDIT;

          case TipoTransacao.WIN:
          case TipoTransacao.REFUND:
            return DirecaoLancamento.DEBIT;

          default:
            throw new Error('Tipo de referencia invalido');
        }

      default:
        throw new Error('Tipo de transacao invalido');
    }
  }

  get id(): string {
    return this.dados.id;
  }

  get status(): StatusTransacao {
    return this.dados.status;
  }

  get kind(): TipoTransacao {
    return this.dados.kind;
  }

  get money(): Money {
    return this.dados.money;
  }

  get walletId(): string {
    return this.dados.walletId;
  }

  get failureCode(): CodigoFalha | undefined {
    return this.dados.failureCode;
  }

  toProps(): WagerTransactionProps {
    return {
      ...this.dados,
      createdAt: new Date(this.dados.createdAt),
      processedAt: this.dados.processedAt
        ? new Date(this.dados.processedAt)
        : undefined
    };
  }
}