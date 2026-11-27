import { Injectable } from '@nestjs/common';

import type {
  OnApplicationBootstrap,
  BeforeApplicationShutdown
} from '@nestjs/common';

import {
  SendMessageCommand
} from '@aws-sdk/client-sqs';

import {
  banco
} from '../banco/data-source';

import {
  OutboxRepository
} from '../banco/repositorios/outbox.repository';

import {
  sqs,
  FILAS,
  buscarUrlFila
} from './sqs.client';

@Injectable()
export class PublisherService
  implements OnApplicationBootstrap,
  BeforeApplicationShutdown {

  private executando = false;

  private tarefa?: Promise<void>;

  onApplicationBootstrap(): void {

    if (process.env.WORKERS_ENABLED === 'false') {
      return;
    }

    this.executando = true;
    this.tarefa = this.publicar();
  }

  async beforeApplicationShutdown(): Promise<void> {

    this.executando = false;

    await this.tarefa;
  }

  private async publicar(): Promise<void> {

    const intervalo = Number(
      process.env.OUTBOX_POLL_INTERVAL_MS ?? '1000'
    );

    while (this.executando) {

      try {

        const url = await buscarUrlFila(
          FILAS.eventos
        );

        const quantidade = await banco.transaction(
          async gerenciador => {

            const repositorio = new OutboxRepository(
              gerenciador
            );

            const mensagens =
              await repositorio.buscarPendentes(1);

            for (const mensagem of mensagens) {

              try {

                await sqs.send(
                  new SendMessageCommand({
                    QueueUrl: url,

                    MessageBody: JSON.stringify(
                      mensagem.payload
                    ),

                    MessageGroupId:
                      mensagem.aggregateId,

                    MessageDeduplicationId:
                      mensagem.id
                  }),
                  {
                    abortSignal: AbortSignal.timeout(5000)
                  }
                );

              } catch {

                const espera = Math.min(
                  2 ** Math.min(mensagem.attempts, 6),
                  60
                );

                mensagem.scheduleRetry(
                  new Date(Date.now() + espera * 1000)
                );

                await repositorio.atualizar(mensagem);

                console.error(JSON.stringify({
                  level: 'error',
                  message: 'Falha na publicacao outbox',
                  eventId: mensagem.id,
                  attempts: mensagem.attempts
                }));

                continue;
              }

              mensagem.markPublished();

              await repositorio.atualizar(mensagem);

              console.log(JSON.stringify({
                level: 'info',
                message: 'Evento publicado',
                eventId: mensagem.id,
                eventType: mensagem.eventType,
                aggregateId: mensagem.aggregateId
              }));
            }

            return mensagens.length;
          }
        );

        if (quantidade === 0) {
          await Bun.sleep(intervalo);
        }

      } catch {

        console.error(JSON.stringify({
          level: 'error',
          message: 'Falha no worker outbox'
        }));

        await Bun.sleep(2000);
      }
    }
  }
}