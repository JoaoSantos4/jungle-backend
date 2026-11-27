import type {
  MigrationInterface,
  QueryRunner
} from 'typeorm';

export class CriarTabelas1795737600000
  implements MigrationInterface {

  async up(queryRunner: QueryRunner): Promise<void> {

    // Carteiras
    await queryRunner.query(`
      CREATE TABLE wallets (
        id UUID PRIMARY KEY,
        player_id UUID NOT NULL,
        currency VARCHAR(3) NOT NULL,
        balance NUMERIC(20,2) NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,

        CONSTRAINT uq_wallet_player_currency
          UNIQUE (player_id, currency),

        CONSTRAINT ck_wallet_balance
          CHECK (balance >= 0 AND balance <> 'NaN'::numeric),

        CONSTRAINT ck_wallet_currency
          CHECK (currency ~ '^[A-Z]{3}$'),

        CONSTRAINT ck_wallet_version
          CHECK (version >= 1)
      );
    `);

    // Transacoes financeiras
    await queryRunner.query(`
      CREATE TABLE wager_transactions (
        id UUID PRIMARY KEY,

        provider_id VARCHAR(255) NOT NULL,
        external_transaction_id VARCHAR(255) NOT NULL,
        idempotency_key VARCHAR(255) NOT NULL,
        payload_hash VARCHAR(64) NOT NULL,

        wallet_id UUID NOT NULL,
        player_id UUID NOT NULL,

        round_id VARCHAR(255) NOT NULL,
        game_id VARCHAR(255) NOT NULL,

        kind SMALLINT NOT NULL,
        status SMALLINT NOT NULL,

        amount NUMERIC(20,2) NOT NULL,
        currency VARCHAR(3) NOT NULL,

        reference_external_transaction_id VARCHAR(255),
        reference_transaction_id UUID,

        failure_code VARCHAR(100),

        result_balance NUMERIC(20,2),

        reference_attempts INTEGER NOT NULL DEFAULT 0,
        next_reference_attempt_at TIMESTAMPTZ,
        reference_expires_at TIMESTAMPTZ,

        created_at TIMESTAMPTZ NOT NULL,
        processed_at TIMESTAMPTZ,

        CONSTRAINT fk_transaction_wallet
          FOREIGN KEY (wallet_id)
          REFERENCES wallets(id),

        CONSTRAINT fk_transaction_reference
          FOREIGN KEY (reference_transaction_id)
          REFERENCES wager_transactions(id),

        CONSTRAINT uq_transaction_provider_external
          UNIQUE (provider_id, external_transaction_id),

        CONSTRAINT uq_transaction_provider_idempotency
          UNIQUE (provider_id, idempotency_key),

        CONSTRAINT ck_transaction_kind
          CHECK (kind BETWEEN 1 AND 6),

        CONSTRAINT ck_transaction_status
          CHECK (status BETWEEN 1 AND 5),

        CONSTRAINT ck_transaction_amount
          CHECK (
            amount <> 'NaN'::numeric
            AND amount >= 0
            AND (kind = 4 OR amount > 0)
          ),

        CONSTRAINT ck_transaction_currency
          CHECK (currency ~ '^[A-Z]{3}$'),

        CONSTRAINT ck_transaction_reference
          CHECK (
            kind NOT IN (5, 6)
            OR reference_external_transaction_id IS NOT NULL
          ),

        CONSTRAINT ck_transaction_result_balance
          CHECK (
            result_balance IS NULL
            OR (
              result_balance >= 0
              AND result_balance <> 'NaN'::numeric
            )
          )
      );
    `);

    // Impede repeticao de reversao do mesmo tipo
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_transaction_reversal
      ON wager_transactions (
        reference_transaction_id,
        kind
      )
      WHERE status = 3
        AND kind IN (5, 6)
        AND reference_transaction_id IS NOT NULL;
    `);

    // Busca de referencias pendentes
    await queryRunner.query(`
      CREATE INDEX idx_transaction_pending_reference
      ON wager_transactions (
        next_reference_attempt_at
      )
      WHERE status = 2;
    `);

    await queryRunner.query(`
      CREATE INDEX idx_transaction_wallet
      ON wager_transactions (wallet_id);
    `);

    // Historico financeiro
    await queryRunner.query(`
      CREATE TABLE wallet_ledger_entries (
        id UUID PRIMARY KEY,
        wallet_id UUID NOT NULL,
        transaction_id UUID NOT NULL,

        direction SMALLINT NOT NULL,
        amount NUMERIC(20,2) NOT NULL,
        currency VARCHAR(3) NOT NULL,

        balance_before NUMERIC(20,2) NOT NULL,
        balance_after NUMERIC(20,2) NOT NULL,

        created_at TIMESTAMPTZ NOT NULL,

        CONSTRAINT fk_ledger_wallet
          FOREIGN KEY (wallet_id)
          REFERENCES wallets(id),

        CONSTRAINT fk_ledger_transaction
          FOREIGN KEY (transaction_id)
          REFERENCES wager_transactions(id),

        CONSTRAINT uq_ledger_wallet_transaction
          UNIQUE (wallet_id, transaction_id),

        CONSTRAINT ck_ledger_direction
          CHECK (direction IN (1, 2)),

        CONSTRAINT ck_ledger_amount
          CHECK (
            amount > 0
            AND amount <> 'NaN'::numeric
          ),

        CONSTRAINT ck_ledger_currency
          CHECK (currency ~ '^[A-Z]{3}$'),

        CONSTRAINT ck_ledger_balances
          CHECK (
            balance_before >= 0
            AND balance_after >= 0
            AND balance_before <> 'NaN'::numeric
            AND balance_after <> 'NaN'::numeric
          ),

        CONSTRAINT ck_ledger_calculation
          CHECK (
            (
              direction = 1
              AND balance_after = balance_before - amount
            )
            OR
            (
              direction = 2
              AND balance_after = balance_before + amount
            )
          )
      );
    `);

    await queryRunner.query(`
      CREATE INDEX idx_ledger_wallet_created
      ON wallet_ledger_entries (
        wallet_id,
        created_at DESC,
        id DESC
      );
    `);

    // Impede alteracao e exclusao do ledger
    await queryRunner.query(`
      CREATE FUNCTION impedir_alteracao_ledger()
      RETURNS TRIGGER AS $$
      BEGIN
        RAISE EXCEPTION 'Ledger financeiro imutavel';
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_ledger_immutable
      BEFORE UPDATE OR DELETE
      ON wallet_ledger_entries
      FOR EACH ROW
      EXECUTE FUNCTION impedir_alteracao_ledger();
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_ledger_no_truncate
      BEFORE TRUNCATE
      ON wallet_ledger_entries
      FOR EACH STATEMENT
      EXECUTE FUNCTION impedir_alteracao_ledger();
    `);

    // Inbox
    await queryRunner.query(`
      CREATE TABLE inbox_messages (
        message_id VARCHAR(255) NOT NULL,
        consumer_name VARCHAR(255) NOT NULL,
        payload_hash VARCHAR(64) NOT NULL,
        received_at TIMESTAMPTZ NOT NULL,
        processed_at TIMESTAMPTZ,

        PRIMARY KEY (consumer_name, message_id)
      );
    `);

    // Outbox
    await queryRunner.query(`
      CREATE TABLE outbox_messages (
        id UUID PRIMARY KEY,
        aggregate_id UUID NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        payload JSONB NOT NULL,

        occurred_at TIMESTAMPTZ NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ NOT NULL,
        published_at TIMESTAMPTZ,

        CONSTRAINT ck_outbox_attempts
          CHECK (attempts >= 0)
      );
    `);

    await queryRunner.query(`
      CREATE INDEX idx_outbox_pending
      ON outbox_messages (
        next_attempt_at,
        occurred_at
      )
      WHERE published_at IS NULL;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {

    await queryRunner.query(`
      DROP TABLE outbox_messages;
    `);

    await queryRunner.query(`
      DROP TABLE inbox_messages;
    `);

    await queryRunner.query(`
      DROP TABLE wallet_ledger_entries;
    `);

    await queryRunner.query(`
      DROP FUNCTION impedir_alteracao_ledger();
    `);

    await queryRunner.query(`
      DROP TABLE wager_transactions;
    `);

    await queryRunner.query(`
      DROP TABLE wallets;
    `);
  }
}