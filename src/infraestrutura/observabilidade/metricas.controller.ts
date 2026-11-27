import {
  Controller,
  Get,
  Header
} from '@nestjs/common';

import {
  GetQueueAttributesCommand
} from '@aws-sdk/client-sqs';

import { banco } from '../banco/data-source';

import {
  sqs,
  FILAS,
  buscarUrlFila
} from '../mensageria/sqs.client';

import {
  registroMetricas,
  mensagensDlq,
  eventosPendentes,
  atrasoOutbox,
  disponibilidade
} from './metricas';

import { logger } from './logger';

@Controller('metrics')
export class MetricasController {

  @Get()
  @Header(
    'Content-Type',
    registroMetricas.contentType
  )
  async buscar(): Promise<string> {

    disponibilidade.set({
      componente: 'aplicacao'
    }, 1);

    try {

      const registros = await banco.manager.query(`
        SELECT
          COUNT(*) AS pendentes,
          COALESCE(
            EXTRACT(
              EPOCH FROM (
                NOW() - MIN(occurred_at)
              )
            ),
            0
          ) AS atraso
        FROM outbox_messages
        WHERE published_at IS NULL
      `);

      eventosPendentes.set(
        Number(registros[0].pendentes)
      );

      atrasoOutbox.set(
        Math.max(0, Number(registros[0].atraso))
      );

      disponibilidade.set({
        componente: 'postgres'
      }, 1);

    } catch {

      disponibilidade.set({
        componente: 'postgres'
      }, 0);

      eventosPendentes.set(NaN);
      atrasoOutbox.set(NaN);

      logger.error('Falha ao coletar metricas do PostgreSQL');
    }

    try {

      const url = await buscarUrlFila(FILAS.dlq);

      const resultado = await sqs.send(
        new GetQueueAttributesCommand({
          QueueUrl: url,
          AttributeNames: [
            'ApproximateNumberOfMessages',
            'ApproximateNumberOfMessagesNotVisible',
            'ApproximateNumberOfMessagesDelayed'
          ]
        }),
        {
          abortSignal: AbortSignal.timeout(3000)
        }
      );

      const atributos = resultado.Attributes;

      mensagensDlq.set(
        Number(atributos?.ApproximateNumberOfMessages ?? '0') +
        Number(atributos?.ApproximateNumberOfMessagesNotVisible ?? '0') +
        Number(atributos?.ApproximateNumberOfMessagesDelayed ?? '0')
      );

      disponibilidade.set({
        componente: 'sqs'
      }, 1);

    } catch {

      disponibilidade.set({
        componente: 'sqs'
      }, 0);

      mensagensDlq.set(NaN);

      logger.error('Falha ao coletar metricas do SQS');
    }

    return registroMetricas.metrics();
  }
}