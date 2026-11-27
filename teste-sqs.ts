import {
  SendMessageCommand
} from '@aws-sdk/client-sqs';

import {
  sqs,
  FILAS,
  buscarUrlFila
} from './src/infraestrutura/mensageria/sqs.client';

const corpo = process.env.MENSAGEM_TESTE;

if (!corpo) {
  throw new Error('Mensagem nao informada');
}

const mensagem = JSON.parse(corpo);

const url = await buscarUrlFila(
  FILAS.transacoes
);

const resultado = await sqs.send(
  new SendMessageCommand({
    QueueUrl: url,
    MessageBody: corpo,
    MessageGroupId: mensagem.data.walletId,
    MessageDeduplicationId: crypto.randomUUID()
  })
);

console.log(resultado);

sqs.destroy();