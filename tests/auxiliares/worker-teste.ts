import { banco } from '../../src/infraestrutura/banco/data-source';
import { TransacaoService } from '../../src/aplicacao/servicos/transacao.service';
import { InboxService } from '../../src/aplicacao/servicos/inbox.service';
import type { TransacaoDto } from '../../src/aplicacao/contratos/transacao.dto';
import { sqs } from '../../src/infraestrutura/mensageria/sqs.client';
import { ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { writeFileSync } from 'node:fs';

await banco.initialize();
try {
  const modo = Bun.argv[2];
  const servico = new TransacaoService();
  if (modo === 'aposta') {
    const entrada = JSON.parse(Bun.argv[3]!) as TransacaoDto;
    const resultado = await servico.processar(entrada);
    writeFileSync(Bun.argv[4]!, JSON.stringify(resultado));
  } else if (modo === 'inbox') {
    const resposta = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: Bun.argv[3]!, WaitTimeSeconds: 5, VisibilityTimeout: 3
    }));
    const mensagem = resposta.Messages?.[0];
    if (!mensagem?.Body) throw new Error('Mensagem ausente');
    await new InboxService(servico).processar(JSON.parse(mensagem.Body));
    writeFileSync(Bun.argv[4]!, 'commit');
    // Aguarda encerramento externo, deliberadamente sem ACK.
    await Bun.sleep(60000);
  } else throw new Error('Modo invalido');
} finally {
  await banco.destroy();
  sqs.destroy();
}
