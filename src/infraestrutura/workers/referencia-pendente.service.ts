import { Injectable, Inject } from '@nestjs/common';
import type { OnApplicationBootstrap, BeforeApplicationShutdown } from '@nestjs/common';
import { banco } from '../banco/data-source';
import { TransacaoService } from '../../aplicacao/servicos/transacao.service';
import { WalletRepository } from '../banco/repositorios/wallet.repository';
import { WagerTransaction } from '../../domain/entidades/wager-transaction';
import { StatusTransacao } from '../../domain/enums/status-transacao';
import { Money } from '../../domain/value-objects/money';
import type { RegistroTransacao } from '../banco/repositorios/wager-transaction.repository';
import { logger } from '../observabilidade/logger';
import { tentativasProcessamento, transacoesProcessadas, latenciaProcessamento, conflitosBloqueio } from '../observabilidade/metricas';

type RegistroPendente = RegistroTransacao;

@Injectable()
export class ReferenciaPendenteService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private executando = false;
  private tarefa?: Promise<void>;
  constructor(@Inject(TransacaoService) private readonly transacoes: TransacaoService) {}
  onApplicationBootstrap(): void {
    if (process.env.WORKERS_ENABLED === 'false') return;
    this.executando = true;
    this.tarefa = this.executar();
  }
  async beforeApplicationShutdown(): Promise<void> {
    this.executando = false;
    await this.tarefa;
  }
  private async executar(): Promise<void> {
    while (this.executando) {
      try { await this.processarPendentes(); }
      catch { logger.error('Falha no worker de referencias'); }
      await Bun.sleep(1000);
    }
  }
  async processarPendentes(): Promise<void> {
    const registros: { id: string; wallet_id: string }[] = await banco.manager.query(`
      SELECT id, wallet_id FROM wager_transactions
      WHERE status = $1 AND (next_reference_attempt_at <= NOW() OR reference_expires_at <= NOW())
      ORDER BY next_reference_attempt_at ASC LIMIT 20
    `, [StatusTransacao.PENDING_REFERENCE]);
    for (const registro of registros) {
      try { await this.reprocessar(registro.id, registro.wallet_id); }
      catch (erro) {
        const falha = erro as { code?: string; driverError?: { code?: string } } | null;
        if (['40P01', '55P03', '40001'].includes(falha?.driverError?.code ?? falha?.code ?? '')) conflitosBloqueio.inc();
        logger.error({ correlationId: registro.id, transactionId: registro.id, walletId: registro.wallet_id }, 'Falha ao reprocessar referencia');
      }
    }
  }
  private async reprocessar(transacaoId: string, carteiraId: string): Promise<void> {
    const finalizar = latenciaProcessamento.startTimer({ origem: 'referencia' });
    try {
      const retorno = await banco.transaction(async gerenciador => {
        const carteiras = new WalletRepository(gerenciador);
        const carteira = await carteiras.buscarComBloqueio(carteiraId);
        if (!carteira) throw new Error('WALLET_NOT_FOUND');
        const registros: RegistroPendente[] = await gerenciador.query(`
          SELECT * FROM wager_transactions WHERE id = $1 AND status = $2
          AND (next_reference_attempt_at <= NOW() OR reference_expires_at <= NOW()) FOR UPDATE
        `, [transacaoId, StatusTransacao.PENDING_REFERENCE]);
        const registro = registros[0];
        if (!registro) return;
        tentativasProcessamento.inc({ origem: 'referencia' });
        const transacao = WagerTransaction.rehydrate({
          id: registro.id, providerId: registro.provider_id,
          externalTransactionId: registro.external_transaction_id,
          idempotencyKey: registro.idempotency_key, payloadHash: registro.payload_hash,
          walletId: registro.wallet_id, playerId: registro.player_id,
          roundId: registro.round_id, gameId: registro.game_id, kind: registro.kind,
          money: Money.from({ amount: registro.amount, currency: registro.currency }),
          status: registro.status,
          referenceExternalTransactionId: registro.reference_external_transaction_id ?? undefined,
          referenceTransactionId: registro.reference_transaction_id ?? undefined,
          failureCode: registro.failure_code ?? undefined,
          createdAt: new Date(registro.created_at),
          processedAt: registro.processed_at ? new Date(registro.processed_at) : undefined
        });
        const contexto = { correlationId: transacao.id };
        const campos = { ...contexto, transactionId: transacao.id, walletId: carteira.id, providerId: registro.provider_id };
        if (registro.reference_expires_at && new Date(registro.reference_expires_at).getTime() <= Date.now()) {
          await this.transacoes.expirarReferencia(transacao, carteira, gerenciador);
          return { ...campos, status: 'REJECTED', expirada: true };
        }
        const resultado = await this.transacoes.aplicar(transacao, carteira, contexto, gerenciador);
        return { ...campos, status: resultado.status, expirada: false };
      });
      // Contabiliza mudancas de status somente depois do commit.
      if (!retorno) return;
      if (retorno.status !== 'PENDING_REFERENCE') transacoesProcessadas.inc({ status: retorno.status });
      if (retorno.expirada) logger.warn(retorno, 'Referencia expirada');
      else logger.info(retorno, 'Referencia reprocessada');
    } finally { finalizar(); }
  }
}
