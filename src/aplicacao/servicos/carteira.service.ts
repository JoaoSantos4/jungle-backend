import { Injectable } from '@nestjs/common';

import { banco } from '../../infraestrutura/banco/data-source';

import { Wallet } from '../../domain/entidades/wallet';
import { Money } from '../../domain/value-objects/money';
import type { MoneyProps } from '../../domain/value-objects/money';

import { WagerTransaction } from '../../domain/entidades/wager-transaction';
import { WalletLedgerEntry } from '../../domain/entidades/wallet-ledger-entry';
import { OutboxMessage } from '../../domain/entidades/outbox-message';

import { TipoTransacao } from '../../domain/enums/tipo-transacao';
import { DirecaoLancamento } from '../../domain/enums/direcao-lancamento';

import { WalletBalanceChanged } from '../../domain/eventos/wallet-balance-changed';

import { WalletRepository } from '../../infraestrutura/banco/repositorios/wallet.repository';
import { WagerTransactionRepository } from '../../infraestrutura/banco/repositorios/wager-transaction.repository';
import { WalletLedgerRepository } from '../../infraestrutura/banco/repositorios/wallet-ledger.repository';
import { OutboxRepository } from '../../infraestrutura/banco/repositorios/outbox.repository';

import { gerarHash } from '../utilitarios/gerar-hash';

@Injectable()
export class CarteiraService {

  async abrir(
    jogadorId: string,
    saldoInicial: MoneyProps,
    correlacaoId = crypto.randomUUID()
  ): Promise<Wallet> {

    const valor = Money.from(saldoInicial);

    if (valor.isNegative()) {
      throw new Error('Saldo inicial invalido');
    }

    if (saldoInicial.currency !== 'BRL') {
      throw new Error('CURRENCY_MISMATCH');
    }

    return banco.transaction(async gerenciador => {

      const carteiras = new WalletRepository(gerenciador);
      const transacoes = new WagerTransactionRepository(gerenciador);
      const ledger = new WalletLedgerRepository(gerenciador);
      const outbox = new OutboxRepository(gerenciador);

      const carteira = Wallet.open(
        jogadorId,
        saldoInicial.currency
      );

      await carteiras.inserir(carteira);

      if (valor.isZero()) {
        return carteira;
      }

      const identificador = crypto.randomUUID();

      const transacao = WagerTransaction.create({
        providerId: 'internal',
        externalTransactionId: identificador,
        idempotencyKey: identificador,
        payloadHash: gerarHash({
          walletId: carteira.id,
          money: valor.toJSON()
        }),
        walletId: carteira.id,
        playerId: jogadorId,
        roundId: 'internal',
        gameId: 'internal',
        kind: TipoTransacao.OPENING,
        money: valor
      });

      const inserida = await transacoes.inserir(transacao);

      if (!inserida) {
        throw new Error('Conflito na abertura da carteira');
      }

      const saldoAnterior = carteira.balance;

      carteira.credit(valor);

      const lancamento = WalletLedgerEntry.create({
        walletId: carteira.id,
        transactionId: transacao.id,
        direction: DirecaoLancamento.CREDIT,
        money: valor,
        balanceBefore: saldoAnterior,
        balanceAfter: carteira.balance
      });

      transacao.markProcessed();

      await carteiras.atualizar(carteira);
      await transacoes.atualizar(transacao, carteira.balance);
      await ledger.inserir(lancamento);

      const evento = WalletBalanceChanged.from(
        carteira,
        lancamento,
        { correlationId: correlacaoId }
      );

      await outbox.inserir(OutboxMessage.enqueue({
        id: evento.eventId,
        aggregateId: evento.aggregateId,
        eventType: evento.eventType,
        occurredAt: evento.occurredAt,
        payload: evento.toJSON()
      }));

      return carteira;
    });
  }

  async buscar(identificador: string): Promise<Wallet | null> {
    const repositorio = new WalletRepository(banco.manager);

    return repositorio.buscarPorId(identificador);
  }

  async reconciliar(carteiraId: string) {
    return banco.transaction(
      'REPEATABLE READ',
      async gerenciador => {

        const carteiras = new WalletRepository(gerenciador);
        const ledger = new WalletLedgerRepository(gerenciador);

        const carteira = await carteiras.buscarPorId(carteiraId);

        if (!carteira) {
          throw new Error('WALLET_NOT_FOUND');
        }

        const resultado = await ledger.calcularSaldo(carteiraId);

        const saldoCalculado = Money.from({
          amount: resultado.saldo,
          currency: carteira.currency
        });

        const diferenca = carteira.balance.subtract(
          saldoCalculado
        );

        return {
          storedBalance: carteira.balance.toJSON(),
          calculatedBalance: saldoCalculado.toJSON(),
          difference: diferenca.toJSON(),
          consistent: diferenca.isZero(),
          checkedEntries: resultado.quantidade
        };
      }
    );
  }
}