import { Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap, BeforeApplicationShutdown } from '@nestjs/common';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { banco } from '../banco/data-source';
import { OutboxRepository } from '../banco/repositorios/outbox.repository';
import { sqs, FILAS, buscarUrlFila } from './sqs.client';
import { logger } from '../observabilidade/logger';
import { tentativasProcessamento, conflitosBloqueio } from '../observabilidade/metricas';

@Injectable()
export class PublisherService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private executando = false;
  private tarefa?: Promise<void>;
  onApplicationBootstrap(): void {
    if (process.env.WORKERS_ENABLED === 'false') return;
    this.executando = true;
    this.tarefa = this.publicar();
  }
  async beforeApplicationShutdown(): Promise<void> {
    this.executando = false;
    await this.tarefa;
  }
  private async publicar(): Promise<void> {
    const intervalo = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? '1000');
    while (this.executando) {
      try {
        const url = await buscarUrlFila(FILAS.eventos);
        const resultados = await banco.transaction(async gerenciador => {
          const repositorio = new OutboxRepository(gerenciador);
          const mensagens = await repositorio.buscarPendentes(1);
          const retornos = [];
          for (const mensagem of mensagens) {
            let publicada = false;
            try {
              await sqs.send(new SendMessageCommand({ QueueUrl: url,
                MessageBody: JSON.stringify(mensagem.payload), MessageGroupId: mensagem.aggregateId,
                MessageDeduplicationId: mensagem.id }), { abortSignal: AbortSignal.timeout(5000) });
              publicada = true;
            } catch {
              const espera = Math.min(2 ** Math.min(mensagem.attempts, 6), 60);
              mensagem.scheduleRetry(new Date(Date.now() + espera * 1000));
            }
            if (publicada) mensagem.markPublished();
            await repositorio.atualizar(mensagem);
            const envelope = mensagem.payload as { correlationId?: string; data?: { walletId?: string; transactionId?: string; providerId?: string } };
            retornos.push({ publicada, eventId: mensagem.id, eventType: mensagem.eventType,
              aggregateId: mensagem.aggregateId, attempts: mensagem.attempts,
              correlationId: envelope.correlationId, walletId: envelope.data?.walletId,
              transactionId: envelope.data?.transactionId, providerId: envelope.data?.providerId });
          }
          return retornos;
        });
        for (const resultado of resultados) {
          if (resultado.publicada) logger.info(resultado, 'Evento publicado');
          else {
            tentativasProcessamento.inc({ origem: 'outbox' });
            logger.error(resultado, 'Falha na publicacao outbox');
          }
        }
        if (resultados.length === 0) await Bun.sleep(intervalo);
      } catch (erro) {
        const falha = erro as { code?: string; driverError?: { code?: string } } | null;
        if (['40P01', '55P03', '40001'].includes(falha?.driverError?.code ?? falha?.code ?? '')) conflitosBloqueio.inc();
        tentativasProcessamento.inc({ origem: 'outbox' });
        logger.error('Falha no worker outbox');
        await Bun.sleep(2000);
      }
    }
  }
}
