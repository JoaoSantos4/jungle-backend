import type { EntityManager } from 'typeorm';

import {
  OutboxMessage
} from '../../../domain/entidades/outbox-message';

export class OutboxRepository {

  constructor(
    private readonly gerenciador: EntityManager
  ) {}

  async inserir(
    mensagem: OutboxMessage
  ): Promise<void> {

    const dados = mensagem.toProps();

    await this.gerenciador.query(`
      INSERT INTO outbox_messages (
        id,
        aggregate_id,
        event_type,
        payload,
        occurred_at,
        attempts,
        next_attempt_at,
        published_at
      )
      VALUES (
        $1, $2, $3, $4::jsonb,
        $5, $6, $7, $8
      )
    `, [
      dados.id,
      dados.aggregateId,
      dados.eventType,
      JSON.stringify(dados.payload),
      dados.occurredAt,
      dados.attempts,
      dados.nextAttemptAt,
      dados.publishedAt ?? null
    ]);
  }

  async buscarPendentes(
    limite = 10
  ): Promise<OutboxMessage[]> {

    if (!this.gerenciador.queryRunner?.isTransactionActive) {
      throw new Error('Bloqueio exige transacao ativa');
    }

    const registros = await this.gerenciador.query(`
      SELECT *
      FROM outbox_messages
      WHERE published_at IS NULL
        AND next_attempt_at <= NOW()
      ORDER BY occurred_at ASC, id ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
    `, [limite]);

    return registros.map((registro: any) =>
      OutboxMessage.rehydrate({
        id: registro.id,
        aggregateId: registro.aggregate_id,
        eventType: registro.event_type,
        payload: registro.payload,
        occurredAt: registro.occurred_at,
        attempts: registro.attempts,
        nextAttemptAt: registro.next_attempt_at,
        publishedAt: registro.published_at ?? undefined
      })
    );
  }

  async atualizar(
    mensagem: OutboxMessage
  ): Promise<void> {

    await this.gerenciador.query(`
      UPDATE outbox_messages
      SET
        attempts = $2,
        next_attempt_at = $3,
        published_at = $4
      WHERE id = $1
        AND published_at IS NULL
    `, [
      mensagem.id,
      mensagem.attempts,
      mensagem.nextAttemptAt,
      mensagem.publishedAt ?? null
    ]);
  }
}