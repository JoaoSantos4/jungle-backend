import {
  Controller,
  Get,
  ServiceUnavailableException
} from '@nestjs/common';

import {
  SQSClient,
  GetQueueUrlCommand
} from '@aws-sdk/client-sqs';

import { banco } from '../../banco/data-source';

@Controller('health')
export class HealthController {

  private readonly sqs = new SQSClient({
    region: process.env.AWS_REGION ?? 'us-east-1',
    endpoint: process.env.SQS_ENDPOINT,
    maxAttempts: 1
  });

  @Get('live')
  live() {
    return {
      status: 'ok'
    };
  }

  @Get('ready')
  async ready() {

    const resultados = await Promise.allSettled([

      banco.manager.query('SELECT 1'),

      this.sqs.send(
        new GetQueueUrlCommand({
          QueueName:
            process.env.SQS_QUEUE_NAME ??
            'wager-transactions.fifo'
        }),
        {
          abortSignal: AbortSignal.timeout(3000)
        }
      )
    ]);

    const postgres =
      resultados[0].status === 'fulfilled';

    const sqs =
      resultados[1].status === 'fulfilled';

    const resposta = {
      status: postgres && sqs ? 'ok' : 'unavailable',
      dependencies: {
        postgres,
        sqs
      }
    };

    if (!postgres || !sqs) {
      throw new ServiceUnavailableException(resposta);
    }

    return resposta;
  }
}