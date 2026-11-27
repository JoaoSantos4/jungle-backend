import {
  Injectable,
  Inject
} from '@nestjs/common';

import type {
  OnApplicationBootstrap,
  BeforeApplicationShutdown
} from '@nestjs/common';

import {
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand
} from '@aws-sdk/client-sqs';

import type {
  Message
} from '@aws-sdk/client-sqs';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  InboxService
} from '../../aplicacao/servicos/inbox.service';

import type {
  MensagemTransacao
} from '../../aplicacao/servicos/inbox.service';

import {
  ProcessarTransacaoDto
} from '../http/contratos/processar-transacao.dto';

import {
  sqs,
  FILAS,
  buscarUrlFila
} from './sqs.client';

@Injectable()
export class ConsumidorService
  implements OnApplicationBootstrap,
  BeforeApplicationShutdown {

  private executando = false;

  private tarefa?: Promise<void>;

  private cancelamento?: AbortController;

  constructor(
    @Inject(InboxService)
    private readonly inbox: InboxService
  ) {}

  onApplicationBootstrap(): void {

    if (process.env.WORKERS_ENABLED === 'false') {
      return;
    }

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

        const url = await buscarUrlFila(
          FILAS.transacoes
        );

        if (!this.executando) {
          break;
        }

        this.cancelamento = new AbortController();

        const resposta = await sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: url,
            MaxNumberOfMessages: 1,
            WaitTimeSeconds: 20,
            VisibilityTimeout: 30,
            MessageSystemAttributeNames: [
              'ApproximateReceiveCount'
            ]
          }),
          {
            abortSignal: this.cancelamento.signal
          }
        );

        this.cancelamento = undefined;

        for (const mensagem of resposta.Messages ?? []) {

          await this.processarMensagem(
            url,
            mensagem
          );
        }

      } catch {

        if (!this.executando) {
          break;
        }

        console.error(JSON.stringify({
          level: 'error',
          message: 'Falha ao consumir fila SQS'
        }));

        await Bun.sleep(2000);
      }
    }
  }

  private async validarMensagem(
    corpo: string
  ): Promise<MensagemTransacao> {

    const mensagem = JSON.parse(corpo);

    if (
      !mensagem ||
      typeof mensagem.messageId !== 'string' ||
      !mensagem.messageId.trim() ||
      mensagem.messageId.length > 255 ||
      mensagem.type !== 'WagerTransactionRequested' ||
      typeof mensagem.occurredAt !== 'string' ||
      !Number.isFinite(Date.parse(mensagem.occurredAt)) ||
      !mensagem.data ||
      typeof mensagem.data !== 'object'
    ) {
      throw new Error('Mensagem SQS invalida');
    }

    const {
      idempotencyKey,
      ...dados
    } = mensagem.data;

    if (
      typeof idempotencyKey !== 'string' ||
      !idempotencyKey.trim() ||
      idempotencyKey.length > 255
    ) {
      throw new Error('Idempotency-Key invalida');
    }

    const dto = plainToInstance(
      ProcessarTransacaoDto,
      dados
    );

    const erros = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true
    });

    if (erros.length > 0) {
      throw new Error('Payload SQS invalido');
    }

    return {
      messageId: mensagem.messageId,
      type: mensagem.type,
      occurredAt: mensagem.occurredAt,
      data: {
        ...dto,
        idempotencyKey
      }
    };
  }

  private async processarMensagem(
    url: string,
    mensagem: Message
  ): Promise<void> {

    if (!mensagem.ReceiptHandle) {
      return;
    }

    let identificador = mensagem.MessageId;

    try {

      const entrada = await this.validarMensagem(
        mensagem.Body ?? ''
      );

      identificador = entrada.messageId;

      const resultado = await this.inbox.processar(
        entrada
      );

      // O commit financeiro ja aconteceu.
      await sqs.send(
        new DeleteMessageCommand({
          QueueUrl: url,
          ReceiptHandle: mensagem.ReceiptHandle
        }),
        {
          abortSignal: AbortSignal.timeout(5000)
        }
      );

      console.log(JSON.stringify({
        level: 'info',
        message: 'Mensagem SQS processada',
        correlationId: entrada.messageId,
        messageId: entrada.messageId,
        walletId: entrada.data.walletId,
        providerId: entrada.data.providerId,
        transactionId:
          resultado.resultado?.transactionId,
        status: resultado.resultado?.status,
        duplicada: resultado.duplicada
      }));

    } catch {

      const tentativas = Number(
        mensagem.Attributes?.ApproximateReceiveCount
        ?? '1'
      );

      const espera = Math.min(
        2 ** Math.min(tentativas, 6),
        60
      );

      console.error(JSON.stringify({
        level: 'error',
        message: 'Falha no processamento SQS',
        messageId: identificador,
        tentativas
      }));

      try {

        await sqs.send(
          new ChangeMessageVisibilityCommand({
            QueueUrl: url,
            ReceiptHandle: mensagem.ReceiptHandle,
            VisibilityTimeout: espera
          }),
          {
            abortSignal: AbortSignal.timeout(5000)
          }
        );

      } catch {

        console.error(JSON.stringify({
          level: 'error',
          message: 'Falha ao alterar visibilidade SQS',
          messageId: identificador
        }));
      }
    }
  }
}