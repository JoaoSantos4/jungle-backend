import { Injectable, Inject } from '@nestjs/common';
import { banco } from '../../infraestrutura/banco/data-source';
import { InboxRepository } from '../../infraestrutura/banco/repositorios/inbox.repository';
import { InboxMessage } from '../../domain/entidades/inbox-message';
import { TransacaoService } from './transacao.service';
import { gerarHash } from '../utilitarios/gerar-hash';
import type { TransacaoDto } from '../contratos/transacao.dto';
import { mensagensDuplicadas, transacoesProcessadas, transacoesDuplicadas, conflitosBloqueio } from '../../infraestrutura/observabilidade/metricas';

export interface MensagemTransacao {
  messageId: string;
  type: 'WagerTransactionRequested';
  occurredAt: string;
  data: TransacaoDto;
}

@Injectable()
export class InboxService {
  constructor(@Inject(TransacaoService) private readonly transacoes: TransacaoService) {}

  async processar(mensagem: MensagemTransacao) {
    const consumidor = 'wager-transactions';
    const hash = gerarHash(mensagem);
    const retorno = await banco.transaction(async gerenciador => {
      const repositorio = new InboxRepository(gerenciador);
      const inbox = InboxMessage.receive({
        messageId: mensagem.messageId,
        consumerName: consumidor,
        payloadHash: hash
      });
      const inserida = await repositorio.inserir(inbox);
      if (!inserida) {
        const existente = await repositorio.buscar(consumidor, mensagem.messageId);
        if (!existente) throw new Error('Mensagem inbox nao encontrada');
        if (existente.payloadHash !== hash) throw new Error('INBOX_PAYLOAD_CONFLICT');
        if (existente.isProcessed()) return { duplicada: true, resultado: null };
        throw new Error('Mensagem inbox inconsistente');
      }
      const resultado = await this.transacoes.processarComGerenciador(mensagem.data, {
        correlationId: mensagem.messageId,
        causationId: mensagem.messageId
      }, gerenciador);
      inbox.markProcessed();
      await repositorio.atualizar(inbox);
      return { duplicada: false, resultado };
    }).catch((erro: unknown) => {
      const falha = erro as { code?: string; driverError?: { code?: string } } | null;
      if (['40P01', '55P03', '40001'].includes(falha?.driverError?.code ?? falha?.code ?? '')) conflitosBloqueio.inc();
      throw erro;
    });
    if (retorno.duplicada) mensagensDuplicadas.inc();
    else if (retorno.resultado?.idempotentReplay) transacoesDuplicadas.inc();
    else if (retorno.resultado) transacoesProcessadas.inc({ status: retorno.resultado.status });
    return retorno;
  }
}
