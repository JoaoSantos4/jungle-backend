import { Injectable, Inject } from '@nestjs/common';
import type { OnApplicationBootstrap, BeforeApplicationShutdown } from '@nestjs/common';
import { ReceiveMessageCommand, DeleteMessageCommand, ChangeMessageVisibilityCommand } from '@aws-sdk/client-sqs';
import type { Message } from '@aws-sdk/client-sqs';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InboxService } from '../../aplicacao/servicos/inbox.service';
import type { MensagemTransacao } from '../../aplicacao/servicos/inbox.service';
import { ProcessarTransacaoDto } from '../http/contratos/processar-transacao.dto';
import { sqs, FILAS, buscarUrlFila } from './sqs.client';
import { logger } from '../observabilidade/logger';
import { tentativasProcessamento, latenciaProcessamento } from '../observabilidade/metricas';

@Injectable()
export class ConsumidorService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private executando = false;
  private tarefa?: Promise<void>;
  private cancelamento?: AbortController;
  constructor(@Inject(InboxService) private readonly inbox: InboxService) {}
  onApplicationBootstrap(): void {
    if (process.env.WORKERS_ENABLED === 'false') return;
    this.executando = true;
    this.tarefa = this.consumir();
  }
  async beforeApplicationShutdown(): Promise<void> {
    this.executando = false;
    this.cancelamento?.abort();
    await this.tarefa;
  }
  private async consumir(): Promise<void> {
    while (this.executando) {
      try {
        const url = await buscarUrlFila(FILAS.transacoes);
        if (!this.executando) break;
        this.cancelamento = new AbortController();
        const resposta = await sqs.send(new ReceiveMessageCommand({
          QueueUrl: url, MaxNumberOfMessages: 1, WaitTimeSeconds: 20,
          VisibilityTimeout: 30, MessageSystemAttributeNames: ['ApproximateReceiveCount']
        }), { abortSignal: this.cancelamento.signal });
        this.cancelamento = undefined;
        for (const mensagem of resposta.Messages ?? []) await this.processarMensagem(url, mensagem);
      } catch {
        if (!this.executando) break;
        tentativasProcessamento.inc({ origem: 'sqs' });
        logger.error('Falha ao consumir fila SQS');
        await Bun.sleep(2000);
      }
    }
  }
  private async validarMensagem(corpo: string): Promise<MensagemTransacao> {
    const mensagem = JSON.parse(corpo);
    if (!mensagem || typeof mensagem.messageId !== 'string' || !mensagem.messageId.trim() ||
      mensagem.messageId.length > 255 || mensagem.type !== 'WagerTransactionRequested' ||
      typeof mensagem.occurredAt !== 'string' || !Number.isFinite(Date.parse(mensagem.occurredAt)) ||
      !mensagem.data || typeof mensagem.data !== 'object') throw new Error('Mensagem SQS invalida');
    const { idempotencyKey, ...dados } = mensagem.data;
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim() || idempotencyKey.length > 255) throw new Error('Idempotency-Key invalida');
    const dto = plainToInstance(ProcessarTransacaoDto, dados);
    const erros = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (erros.length > 0) throw new Error('Payload SQS invalido');
    return { messageId: mensagem.messageId, type: mensagem.type, occurredAt: mensagem.occurredAt, data: { ...dto, idempotencyKey } };
  }
  private async processarMensagem(url: string, mensagem: Message): Promise<void> {
    if (!mensagem.ReceiptHandle) return;
    const finalizar = latenciaProcessamento.startTimer({ origem: 'sqs' });
    let identificador = mensagem.MessageId;
    let entrada: MensagemTransacao | undefined;
    try {
      entrada = await this.validarMensagem(mensagem.Body ?? '');
      identificador = entrada.messageId;
      const resultado = await this.inbox.processar(entrada);
      // Confirma somente depois do commit financeiro.
      await sqs.send(new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: mensagem.ReceiptHandle }), { abortSignal: AbortSignal.timeout(5000) });
      logger.info({ correlationId: entrada.messageId, messageId: entrada.messageId,
        walletId: entrada.data.walletId, providerId: entrada.data.providerId,
        transactionId: resultado.resultado?.transactionId, status: resultado.resultado?.status,
        duplicada: resultado.duplicada }, 'Mensagem SQS processada');
    } catch {
      tentativasProcessamento.inc({ origem: 'sqs' });
      const tentativas = Number(mensagem.Attributes?.ApproximateReceiveCount ?? '1');
      const espera = Math.min(2 ** Math.min(tentativas, 6), 60);
      logger.error({ correlationId: identificador, messageId: identificador, walletId: entrada?.data.walletId, providerId: entrada?.data.providerId, tentativas }, 'Falha no processamento SQS');
      try {
        await sqs.send(new ChangeMessageVisibilityCommand({ QueueUrl: url, ReceiptHandle: mensagem.ReceiptHandle, VisibilityTimeout: espera }), { abortSignal: AbortSignal.timeout(5000) });
      } catch {
        logger.error({ messageId: identificador }, 'Falha ao alterar visibilidade SQS');
      }
    } finally { finalizar(); }
  }
}
