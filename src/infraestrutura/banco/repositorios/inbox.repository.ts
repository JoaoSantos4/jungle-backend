import type { EntityManager } from 'typeorm';

import {
  InboxMessage
} from '../../../domain/entidades/inbox-message';

export class InboxRepository {

  constructor(
    private readonly gerenciador: EntityManager
  ) {}

  async inserir(
    mensagem: InboxMessage
  ): Promise<boolean> {

    const dados = mensagem.toProps();

    const registros = await this.gerenciador.query(`
      INSERT INTO inbox_messages (
        message_id,
        consumer_name,
        payload_hash,
        received_at
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (
        consumer_name,
        message_id
      )
      DO NOTHING
      RETURNING message_id
    `, [
      dados.messageId,
      dados.consumerName,
      dados.payloadHash,
      dados.receivedAt
    ]);

    return registros.length === 1;
  }

  async buscar(
    consumidor: string,
    mensagemId: string
  ): Promise<InboxMessage | null> {

    const registros = await this.gerenciador.query(`
      SELECT *
      FROM inbox_messages
      WHERE consumer_name = $1
        AND message_id = $2
    `, [
      consumidor,
      mensagemId
    ]);

    const registro = registros[0];

    if (!registro) {
      return null;
    }

    return InboxMessage.rehydrate({
      messageId: registro.message_id,
      consumerName: registro.consumer_name,
      payloadHash: registro.payload_hash,
      receivedAt: registro.received_at,
      processedAt: registro.processed_at ?? undefined
    });
  }

  async atualizar(
    mensagem: InboxMessage
  ): Promise<void> {

    if (!mensagem.isProcessed()) {
      throw new Error('Mensagem ainda nao processada');
    }

    await this.gerenciador.query(`
      UPDATE inbox_messages
      SET processed_at = $3
      WHERE consumer_name = $1
        AND message_id = $2
        AND processed_at IS NULL
    `, [
      mensagem.consumerName,
      mensagem.messageId,
      mensagem.processedAt
    ]);
  }
}