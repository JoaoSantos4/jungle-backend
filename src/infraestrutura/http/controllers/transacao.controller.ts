import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  Param,
  Inject,
  Res,
  ParseUUIDPipe,
  BadRequestException,
  NotFoundException
} from '@nestjs/common';

import { TransacaoService } from '../../../aplicacao/servicos/transacao.service';

import {
  ProcessarTransacaoDto
} from '../contratos/processar-transacao.dto';

import { banco } from '../../banco/data-source';

import {
  WagerTransactionRepository
} from '../../banco/repositorios/wager-transaction.repository';

import type {
  RegistroTransacao
} from '../../banco/repositorios/wager-transaction.repository';

import {
  StatusTransacao
} from '../../../domain/enums/status-transacao';

import {
  TipoTransacao
} from '../../../domain/enums/tipo-transacao';

@Controller()
export class TransacaoController {

  constructor(
    @Inject(TransacaoService)
    private readonly servico: TransacaoService
  ) {}

  @Post('wagering/transactions')
  async processar(
    @Body() entrada: ProcessarTransacaoDto,

    @Headers('idempotency-key')
    chave: string,

    @Res({ passthrough: true })
    resposta: { status(codigo: number): unknown }
  ) {

    if (
      typeof chave !== 'string' ||
      !chave.trim() ||
      chave.length > 255
    ) {
      throw new BadRequestException(
        'Idempotency-Key obrigatoria ou invalida'
      );
    }

    const resultado = await this.servico.processar({
      ...entrada,
      idempotencyKey: chave
    });

    switch (resultado.status) {

      case 'PENDING':
      case 'PENDING_REFERENCE':
        resposta.status(202);
        break;

      case 'REJECTED':
        resposta.status(422);
        break;

      case 'FAILED':
        resposta.status(500);
        break;

      default:
        resposta.status(200);
    }

    return resultado;
  }

  @Get('wagering/transactions/:transactionId')
  async buscarPorId(
    @Param('transactionId', ParseUUIDPipe)
    identificador: string
  ) {

    const repositorio = new WagerTransactionRepository(
      banco.manager
    );

    const registro = await repositorio.buscarPorId(
      identificador
    );

    if (!registro) {
      throw new NotFoundException('TRANSACTION_NOT_FOUND');
    }

    return this.serializar(registro);
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  async buscarPorIdentificadorExterno(
    @Param('providerId')
    provedorId: string,

    @Param('externalTransactionId')
    identificadorExterno: string
  ) {

    const repositorio = new WagerTransactionRepository(
      banco.manager
    );

    const registro =
      await repositorio.buscarPorIdentificadorExterno(
        provedorId,
        identificadorExterno
      );

    if (!registro) {
      throw new NotFoundException('TRANSACTION_NOT_FOUND');
    }

    return this.serializar(registro);
  }

  private serializar(registro: RegistroTransacao) {

    return {
      transactionId: registro.id,
      providerId: registro.provider_id,
      externalTransactionId:
        registro.external_transaction_id,
      walletId: registro.wallet_id,
      playerId: registro.player_id,
      roundId: registro.round_id,
      gameId: registro.game_id,
      kind: TipoTransacao[registro.kind],
      status: StatusTransacao[registro.status],
      money: {
        amount: registro.amount,
        currency: registro.currency
      },
      referenceExternalTransactionId:
        registro.reference_external_transaction_id,
      referenceTransactionId:
        registro.reference_transaction_id,
      failureCode: registro.failure_code,
      createdAt: registro.created_at,
      processedAt: registro.processed_at
    };
  }
}