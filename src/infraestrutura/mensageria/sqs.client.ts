import {
  SQSClient,
  GetQueueUrlCommand
} from '@aws-sdk/client-sqs';

export const sqs = new SQSClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
  endpoint: process.env.SQS_ENDPOINT,
  maxAttempts: 2
});

export const FILAS = {
  transacoes:
    process.env.SQS_QUEUE_NAME ??
    'wager-transactions.fifo',

  dlq:
    process.env.SQS_DLQ_NAME ??
    'wager-transactions-dlq.fifo',

  eventos:
    process.env.SQS_EVENTS_QUEUE_NAME ??
    'wager-events.fifo'
};

export async function buscarUrlFila(
  nome: string
): Promise<string> {

  const resultado = await sqs.send(
    new GetQueueUrlCommand({
      QueueName: nome
    }),
    {
      abortSignal: AbortSignal.timeout(5000)
    }
  );

  if (!resultado.QueueUrl) {
    throw new Error('Fila nao encontrada');
  }

  return resultado.QueueUrl;
}