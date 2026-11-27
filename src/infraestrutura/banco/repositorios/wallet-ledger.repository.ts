import type { EntityManager } from 'typeorm';

import {
  WalletLedgerEntry
} from '../../../domain/entidades/wallet-ledger-entry';

export class WalletLedgerRepository {

  constructor(
    private readonly gerenciador: EntityManager
  ) {}

  async inserir(
    lancamento: WalletLedgerEntry
  ): Promise<void> {

    const dados = lancamento.toProps();
    const valor = dados.money.toJSON();

    await this.gerenciador.query(`
      INSERT INTO wallet_ledger_entries (
        id,
        wallet_id,
        transaction_id,
        direction,
        amount,
        currency,
        balance_before,
        balance_after,
        created_at
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9
      )
    `, [
      dados.id,
      dados.walletId,
      dados.transactionId,
      dados.direction,
      valor.amount,
      valor.currency,
      dados.balanceBefore.toJSON().amount,
      dados.balanceAfter.toJSON().amount,
      dados.createdAt
    ]);
  }

  async calcularSaldo(
    carteiraId: string
  ): Promise<{
    saldo: string;
    quantidade: number;
  }> {

    const registros = await this.gerenciador.query(`
      SELECT
        COALESCE(
          SUM(
            CASE
              WHEN direction = 1 THEN -amount
              WHEN direction = 2 THEN amount
            END
          ),
          0
        )::text AS saldo,
        COUNT(*)::text AS quantidade
      FROM wallet_ledger_entries
      WHERE wallet_id = $1
    `, [carteiraId]);

    return {
      saldo: registros[0].saldo,
      quantidade: Number(registros[0].quantidade)
    };
  }
}