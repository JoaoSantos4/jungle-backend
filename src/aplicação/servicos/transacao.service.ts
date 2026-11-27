import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { banco } from '../../infraestrutura/banco/data-source';

import { Money } from '../../domain/value-objects/money';
import { Wallet } from '../../domain/entidades/wallet';
import { WagerTransaction } from '../../domain/entidades/wager-transaction';
import { WalletLedgerEntry } from '../../domain/entidades/wallet-ledger-entry';
import { OutboxMessage } from '../../domain/entidades/outbox-message';

import { TipoTransacao } from '../../domain/enums/tipo-transacao';
import { StatusTransacao } from '../../domain/enums/status-transacao';
import { DirecaoLancamento } from '../../domain/enums/direcao-lancamento';
import { CodigoFalha } from '../../domain/enums/codigo-falha';

import { WagerTransactionProcessed } from '../../domain/eventos/wager-transaction-processed';
import { WagerTransactionRejected } from '../../domain/eventos/wager-transaction-rejected';
import { WagerTransactionPendingReference } from '../../domain/eventos/wager-transaction-pending-reference';
import { WalletBalanceChanged } from '../../domain/eventos/wallet-balance-changed';

import type {
  IntegrationEvent,
  EventContext
} from '../../domain/eventos/integration-event';

import { WalletRepository } from '../../infraestrutura/banco/repositorios/wallet.repository';

import {
  WagerTransactionRepository
} from '../../infraestrutura/banco/repositorios/wager-transaction.repository';

import type {
  RegistroTransacao
} from '../../infraestrutura/banco/repositorios/wager-transaction.repository';

import { WalletLedgerRepository } from '../../infraestrutura/banco/repositorios/wallet-ledger.repository';
import { OutboxRepository } from '../../infraestrutura/banco/repositorios/outbox.repository';

import type {
  TransacaoDto,
  ResultadoTransacao
} from '../contratos/transacao.dto';

import { gerarHash } from '../utilitarios/gerar-hash';

@Injectable()
export class TransacaoService {

  async processar(
    entrada: TransacaoDto,
    contexto: EventContext = {
      correlationId: crypto.randomUUID()
    }
  ): Promise<ResultadoTransacao> {

    return banco.transaction(gerenciador =>
      this.processarComGerenciador(
        entrada,
        contexto,
        gerenciador
      )
    );
  }

  async processarComGerenciador(
    entrada: TransacaoDto,
    contexto: EventContext,
    gerenciador: EntityManager
  ): Promise<ResultadoTransacao> {

    if (!gerenciador.queryRunner?.isTransactionActive) {
      throw new Error('Processamento exige transacao ativa');
    }

    const carteiras = new WalletRepository(gerenciador);
    const transacoes = new WagerTransactionRepository(gerenciador);

    const valor = Money.from(entrada.money);

    const tiposPermitidos = [
      'BET',
      'WIN',
      'LOSS',
      'REFUND',
      'ROLLBACK'
    ];

    if (!tiposPermitidos.includes(entrada.kind)) {
      throw new Error('Tipo de transacao invalido');
    }

    if (entrada.providerId === 'internal') {
      throw new Error('Provedor reservado');
    }

    const tipo = TipoTransacao[entrada.kind];

    const {
      idempotencyKey: chave,
      ...dadosNegocio
    } = entrada;

    if (!chave?.trim()) {
      throw new Error('Idempotency-Key obrigatoria');
    }

    const hash = gerarHash({
      ...dadosNegocio,
      money: valor.toJSON()
    });

    const carteira = await carteiras.buscarComBloqueio(
      entrada.walletId
    );

    const repetida = await this.buscarRepetida(
      transacoes,
      entrada,
      hash
    );

    if (repetida) {
      return this.resultadoPersistido(repetida);
    }

    if (!carteira) {
      throw new Error('WALLET_NOT_FOUND');
    }

    const transacao = WagerTransaction.create({
      ...entrada,
      kind: tipo,
      money: valor,
      payloadHash: hash
    });

    const inserida = await transacoes.inserir(transacao);

    if (!inserida) {

      const existente = await this.buscarRepetida(
        transacoes,
        entrada,
        hash
      );

      if (!existente) {
        throw new Error('Conflito ao inserir transacao');
      }

      return this.resultadoPersistido(existente);
    }

    return this.aplicar(
      transacao,
      carteira,
      contexto,
      gerenciador
    );
  }

  private async buscarRepetida(
    repositorio: WagerTransactionRepository,
    entrada: TransacaoDto,
    hash: string
  ): Promise<RegistroTransacao | null> {

    const porChave = await repositorio.buscarPorIdempotencia(
      entrada.providerId,
      entrada.idempotencyKey
    );

    const porExterno =
      await repositorio.buscarPorIdentificadorExterno(
        entrada.providerId,
        entrada.externalTransactionId
      );

    if (
      porChave &&
      porExterno &&
      porChave.id !== porExterno.id
    ) {
      throw new Error('IDEMPOTENCY_CONFLICT');
    }

    const existente = porChave ?? porExterno;

    if (existente && existente.payload_hash !== hash) {
      throw new Error('IDEMPOTENCY_CONFLICT');
    }

    return existente;
  }

  private async registrarEvento<T>(
    repositorio: OutboxRepository,
    evento: IntegrationEvent<T>
  ): Promise<void> {

    await repositorio.inserir(OutboxMessage.enqueue({
      id: evento.eventId,
      aggregateId: evento.aggregateId,
      eventType: evento.eventType,
      occurredAt: evento.occurredAt,
      payload: evento.toJSON()
    }));
  }

  async aplicar(
    transacao: WagerTransaction,
    carteira: Wallet,
    contexto: EventContext,
    gerenciador: EntityManager
  ): Promise<ResultadoTransacao> {

    const carteiras = new WalletRepository(gerenciador);
    const transacoes = new WagerTransactionRepository(gerenciador);
    const ledger = new WalletLedgerRepository(gerenciador);
    const outbox = new OutboxRepository(gerenciador);

    const dados = transacao.toProps();

    const rejeitar = async (
      codigo: CodigoFalha
    ): Promise<ResultadoTransacao> => {

      transacao.reject(codigo);

      await transacoes.atualizar(
        transacao,
        carteira.balance
      );

      await this.registrarEvento(
        outbox,
        WagerTransactionRejected.from(
          transacao,
          contexto
        )
      );

      return this.resultado(
        transacao,
        carteira.balance
      );
    };

    // Validacao de moeda
    if (
      dados.money.toJSON().currency !== carteira.currency ||
      carteira.currency !== 'BRL'
    ) {
      return rejeitar(CodigoFalha.MOEDA_DIVERGENTE);
    }

    // Validacao do jogador
    if (dados.playerId !== carteira.playerId) {
      return rejeitar(CodigoFalha.ESCOPO_REFERENCIA_INVALIDO);
    }

    let referencia: RegistroTransacao | null = null;

    if (dados.referenceExternalTransactionId) {

      referencia =
        await transacoes.buscarPorIdentificadorExterno(
          dados.providerId,
          dados.referenceExternalTransactionId
        );

      if (!referencia && transacao.requiresReference()) {

        const primeiraTentativa =
          transacao.status !== StatusTransacao.PENDING_REFERENCE;

        transacao.markPendingReference();

        await transacoes.atualizar(
          transacao,
          carteira.balance
        );

        await gerenciador.query(`
          UPDATE wager_transactions
          SET
            reference_attempts = reference_attempts + 1,
            next_reference_attempt_at =
              NOW() + INTERVAL '1 second' *
              LEAST(POWER(2, LEAST(reference_attempts, 6)), 60),
            reference_expires_at = COALESCE(
              reference_expires_at,
              NOW() + INTERVAL '24 hours'
            )
          WHERE id = $1
        `, [transacao.id]);

        if (primeiraTentativa) {
          await this.registrarEvento(
            outbox,
            WagerTransactionPendingReference.from(
              transacao,
              contexto
            )
          );
        }

        return this.resultado(
          transacao,
          carteira.balance
        );
      }

      if (!referencia) {
        return rejeitar(CodigoFalha.REFERENCIA_NAO_ENCONTRADA);
      }

      if (
        referencia.wallet_id !== dados.walletId ||
        referencia.player_id !== dados.playerId ||
        referencia.round_id !== dados.roundId ||
        referencia.provider_id !== dados.providerId ||
        referencia.currency !== carteira.currency ||
        referencia.id === transacao.id
      ) {
        return rejeitar(CodigoFalha.ESCOPO_REFERENCIA_INVALIDO);
      }

      if (referencia.status !== StatusTransacao.PROCESSED) {

        if (
          transacao.requiresReference() &&
          (
            referencia.status === StatusTransacao.PENDING ||
            referencia.status === StatusTransacao.PENDING_REFERENCE
          )
        ) {
          const primeiraTentativa =
            transacao.status !== StatusTransacao.PENDING_REFERENCE;

          transacao.markPendingReference();

          await transacoes.atualizar(transacao, carteira.balance);

          await gerenciador.query(`
            UPDATE wager_transactions
            SET
              reference_attempts = reference_attempts + 1,
              next_reference_attempt_at =
                NOW() + INTERVAL '1 second' *
                LEAST(POWER(2, LEAST(reference_attempts, 6)), 60),
              reference_expires_at = COALESCE(
                reference_expires_at,
                NOW() + INTERVAL '24 hours'
              )
            WHERE id = $1
          `, [transacao.id]);

          if (primeiraTentativa) {
            await this.registrarEvento(
              outbox,
              WagerTransactionPendingReference.from(
                transacao,
                contexto
              )
            );
          }

          return this.resultado(transacao, carteira.balance);
        }

        return rejeitar(CodigoFalha.REFERENCIA_NAO_PROCESSADA);
      }
    }

    // Regras de REFUND
    if (dados.kind === TipoTransacao.REFUND) {

      if (referencia?.kind !== TipoTransacao.BET) {
        return rejeitar(CodigoFalha.TIPO_REFERENCIA_INVALIDO);
      }
    }

    // Regras de ROLLBACK
    if (dados.kind === TipoTransacao.ROLLBACK) {

      const tiposValidos = [
        TipoTransacao.BET,
        TipoTransacao.WIN,
        TipoTransacao.REFUND
      ];

      if (!referencia || !tiposValidos.includes(referencia.kind)) {
        return rejeitar(CodigoFalha.TIPO_REFERENCIA_INVALIDO);
      }
    }

    // WIN com referencia deve apontar para BET
    if (
      dados.kind === TipoTransacao.WIN &&
      referencia &&
      referencia.kind !== TipoTransacao.BET
    ) {
      return rejeitar(CodigoFalha.TIPO_REFERENCIA_INVALIDO);
    }

    // Validacoes compartilhadas pelas reversoes
    if (transacao.requiresReference() && referencia) {

      const valorReferencia = Money.from({
        amount: referencia.amount,
        currency: referencia.currency
      });

      if (!dados.money.equals(valorReferencia)) {
        return rejeitar(CodigoFalha.VALOR_REFERENCIA_DIVERGENTE);
      }

      const possuiRefund = await transacoes.existeReversao(
        referencia.id,
        TipoTransacao.REFUND
      );

      const possuiRollback = await transacoes.existeReversao(
        referencia.id,
        TipoTransacao.ROLLBACK
      );

      if (possuiRefund || possuiRollback) {
        return rejeitar(CodigoFalha.TRANSACAO_JA_REVERTIDA);
      }
    }

    const direcao = transacao.ledgerDirectionFor(
      referencia?.kind
    );

    // Validacao de saldo antes de debitar
    if (
      direcao === DirecaoLancamento.DEBIT &&
      carteira.balance.isLessThan(dados.money)
    ) {
      return rejeitar(
        dados.kind === TipoTransacao.ROLLBACK
          ? CodigoFalha.SALDO_INSUFICIENTE_REVERSAO
          : CodigoFalha.SALDO_INSUFICIENTE
      );
    }

    // Movimentacao financeira
    if (direcao !== null) {

      const saldoAnterior = carteira.balance;

      if (direcao === DirecaoLancamento.DEBIT) {
        carteira.debit(dados.money);
      } else {
        carteira.credit(dados.money);
      }

      const lancamento = WalletLedgerEntry.create({
        walletId: carteira.id,
        transactionId: transacao.id,
        direction: direcao,
        money: dados.money,
        balanceBefore: saldoAnterior,
        balanceAfter: carteira.balance
      });

      await carteiras.atualizar(carteira);
      await ledger.inserir(lancamento);

      await this.registrarEvento(
        outbox,
        WalletBalanceChanged.from(
          carteira,
          lancamento,
          contexto
        )
      );
    }

    // Finalizacao
    transacao.markProcessed(referencia?.id);

    await transacoes.atualizar(
      transacao,
      carteira.balance
    );

    await this.registrarEvento(
      outbox,
      WagerTransactionProcessed.from(
        transacao,
        contexto
      )
    );

    return this.resultado(
      transacao,
      carteira.balance
    );
  }

  private resultado(
    transacao: WagerTransaction,
    saldo: Money
  ): ResultadoTransacao {

    return {
      transactionId: transacao.id,
      status: StatusTransacao[transacao.status]!,
      balance: saldo.toJSON(),
      idempotentReplay: false,
      failureCode: transacao.failureCode
    };
  }

  private resultadoPersistido(
    registro: RegistroTransacao
  ): ResultadoTransacao {

    return {
      transactionId: registro.id,
      status: StatusTransacao[registro.status]!,
      balance: registro.result_balance === null
        ? null
        : {
            amount: registro.result_balance,
            currency: registro.currency
          },
      idempotentReplay: true,
      failureCode: registro.failure_code ?? undefined
    };
  }
}