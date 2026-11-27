import type { EntityManager } from 'typeorm';

import {
  WagerTransaction
} from '../../../domain/entidades/wager-transaction';

import { Money } from '../../../domain/value-objects/money';

import type {
  TipoTransacao
} from '../../../domain/enums/tipo-transacao';

import type {
  StatusTransacao
} from '../../../domain/enums/status-transacao';

import type {
  CodigoFalha
} from '../../../domain/enums/codigo-falha';

export interface RegistroTransacao {
  id: string;
  provider_id: string;
  external_transaction_id: string;
  idempotency_key: string;
  payload_hash: string;
  wallet_id: string;
  player_id: string;
  round_id: string;
  game_id: string;
  kind: TipoTransacao;
  status: StatusTransacao;
  amount: string;
  currency: string;
  reference_external_transaction_id: string | null;
  reference_transaction_id: string | null;
  failure_code: CodigoFalha | null;
  result_balance: string | null;
  reference_attempts: number;
  next_reference_attempt_at: Date | null;
  reference_expires_at: Date | null;
  created_at: Date;
  processed_at: Date | null;
}

export class WagerTransactionRepository {

  constructor(
    private readonly gerenciador: EntityManager
  ) {}

  reconstruir(
    registro: RegistroTransacao
  ): WagerTransaction {

    return WagerTransaction.rehydrate({
      id: registro.id,
      providerId: registro.provider_id,
      externalTransactionId:
        registro.external_transaction_id,
      idempotencyKey: registro.idempotency_key,
      payloadHash: registro.payload_hash,
      walletId: registro.wallet_id,
      playerId: registro.player_id,
      roundId: registro.round_id,
      gameId: registro.game_id,
      kind: registro.kind,
      status: registro.status,

      money: Money.from({
        amount: registro.amount,
        currency: registro.currency
      }),

      referenceExternalTransactionId:
        registro.reference_external_transaction_id
        ?? undefined,

      referenceTransactionId:
        registro.reference_transaction_id
        ?? undefined,

      failureCode:
        registro.failure_code ?? undefined,

      createdAt: registro.created_at,

      processedAt:
        registro.processed_at ?? undefined
    });
  }

  async inserir(
    transacao: WagerTransaction
  ): Promise<boolean> {

    const dados = transacao.toProps();
    const valor = dados.money.toJSON();

    const registros = await this.gerenciador.query(`
      INSERT INTO wager_transactions (
        id,
        provider_id,
        external_transaction_id,
        idempotency_key,
        payload_hash,
        wallet_id,
        player_id,
        round_id,
        game_id,
        kind,
        status,
        amount,
        currency,
        reference_external_transaction_id,
        created_at
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `, [
      dados.id,
      dados.providerId,
      dados.externalTransactionId,
      dados.idempotencyKey,
      dados.payloadHash,
      dados.walletId,
      dados.playerId,
      dados.roundId,
      dados.gameId,
      dados.kind,
      dados.status,
      valor.amount,
      valor.currency,
      dados.referenceExternalTransactionId ?? null,
      dados.createdAt
    ]);

    return registros.length === 1;
  }

  async buscarPorId(
    identificador: string
  ): Promise<RegistroTransacao | null> {

    const registros: RegistroTransacao[] =
      await this.gerenciador.query(`
        SELECT *
        FROM wager_transactions
        WHERE id = $1
      `, [identificador]);

    return registros[0] ?? null;
  }

  async buscarPorIdentificadorExterno(
    provedorId: string,
    identificadorExterno: string
  ): Promise<RegistroTransacao | null> {

    const registros: RegistroTransacao[] =
      await this.gerenciador.query(`
        SELECT *
        FROM wager_transactions
        WHERE provider_id = $1
          AND external_transaction_id = $2
      `, [
        provedorId,
        identificadorExterno
      ]);

    return registros[0] ?? null;
  }

  async buscarPorIdempotencia(
    provedorId: string,
    chave: string
  ): Promise<RegistroTransacao | null> {

    const registros: RegistroTransacao[] =
      await this.gerenciador.query(`
        SELECT *
        FROM wager_transactions
        WHERE provider_id = $1
          AND idempotency_key = $2
      `, [provedorId, chave]);

    return registros[0] ?? null;
  }

  async existeReversao(
    referenciaId: string,
    tipo: TipoTransacao
  ): Promise<boolean> {

    const registros = await this.gerenciador.query(`
      SELECT id
      FROM wager_transactions
      WHERE reference_transaction_id = $1
        AND kind = $2
        AND status = 3
      LIMIT 1
    `, [referenciaId, tipo]);

    return registros.length > 0;
  }

  async atualizar(
    transacao: WagerTransaction,
    saldoResultado: Money | null
  ): Promise<void> {

    const dados = transacao.toProps();

    const registros = await this.gerenciador.query(`
      WITH atualizacao AS (
        UPDATE wager_transactions
        SET
          status = $2,
          reference_transaction_id = $3,
          failure_code = $4,
          processed_at = $5,
          result_balance = $6
        WHERE id = $1
          AND status IN (1, 2)
        RETURNING id
      )
      SELECT id FROM atualizacao
    `, [
      dados.id,
      dados.status,
      dados.referenceTransactionId ?? null,
      dados.failureCode ?? null,
      dados.processedAt ?? null,
      saldoResultado?.toJSON().amount ?? null
    ]);

    if (registros.length !== 1) {
      throw new Error('Transacao inexistente ou finalizada');
    }
  }
}