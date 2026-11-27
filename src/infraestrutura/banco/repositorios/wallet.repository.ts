import type { EntityManager } from 'typeorm';
import { Wallet } from '../../../domain/entidades/wallet';
import { Money } from '../../../domain/value-objects/money';

interface RegistroWallet {
  id: string;
  player_id: string;
  currency: string;
  balance: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export class WalletRepository {

  constructor(
    private readonly gerenciador: EntityManager
  ) {}

  private reconstruir(registro: RegistroWallet): Wallet {
    return Wallet.rehydrate({
      id: registro.id,
      playerId: registro.player_id,
      currency: registro.currency,
      balance: Money.from({
        amount: registro.balance,
        currency: registro.currency
      }),
      version: registro.version,
      createdAt: registro.created_at,
      updatedAt: registro.updated_at
    });
  }

  async inserir(carteira: Wallet): Promise<void> {
    await this.gerenciador.query(`
      INSERT INTO wallets (
        id,
        player_id,
        currency,
        balance,
        version,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      carteira.id,
      carteira.playerId,
      carteira.currency,
      carteira.balance.toJSON().amount,
      carteira.version,
      carteira.createdAt,
      carteira.updatedAt
    ]);
  }

  async buscarPorId(
    identificador: string
  ): Promise<Wallet | null> {

    const registros: RegistroWallet[] =
      await this.gerenciador.query(`
        SELECT *
        FROM wallets
        WHERE id = $1
      `, [identificador]);

    const registro = registros[0];

    return registro
      ? this.reconstruir(registro)
      : null;
  }

  async buscarComBloqueio(
    identificador: string
  ): Promise<Wallet | null> {

    if (!this.gerenciador.queryRunner?.isTransactionActive) {
      throw new Error('Bloqueio exige transacao ativa');
    }

    const registros: RegistroWallet[] =
      await this.gerenciador.query(`
        SELECT *
        FROM wallets
        WHERE id = $1
        FOR UPDATE
      `, [identificador]);

    const registro = registros[0];

    return registro
      ? this.reconstruir(registro)
      : null;
  }

  async atualizar(carteira: Wallet): Promise<void> {

    if (!this.gerenciador.queryRunner?.isTransactionActive) {
      throw new Error('Atualizacao exige transacao ativa');
    }

    const registros = await this.gerenciador.query(`
      WITH atualizacao AS (
        UPDATE wallets
        SET
          balance = $2,
          version = $3,
          updated_at = $4
        WHERE id = $1
          AND version = $3 - 1
        RETURNING id
      )
      SELECT id FROM atualizacao
    `, [
      carteira.id,
      carteira.balance.toJSON().amount,
      carteira.version,
      carteira.updatedAt
    ]);

    if (registros.length !== 1) {
      throw new Error('Conflito de versao da carteira');
    }
  }
}