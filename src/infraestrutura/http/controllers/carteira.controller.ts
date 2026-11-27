import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Inject,
  ParseUUIDPipe,
  NotFoundException,
  BadRequestException
} from '@nestjs/common';

import { CarteiraService } from '../../../aplicacao/servicos/carteira.service';
import { AbrirCarteiraDto } from '../contratos/abrir-carteira.dto';

import { banco } from '../../banco/data-source';

import {
  Wallet
} from '../../../domain/entidades/wallet';

import {
  DirecaoLancamento
} from '../../../domain/enums/direcao-lancamento';

@Controller('wallets')
export class CarteiraController {

  constructor(
    @Inject(CarteiraService)
    private readonly servico: CarteiraService
  ) {}

  private serializar(carteira: Wallet) {
    return {
      walletId: carteira.id,
      playerId: carteira.playerId,
      currency: carteira.currency,
      balance: carteira.balance.toJSON(),
      version: carteira.version,
      createdAt: carteira.createdAt,
      updatedAt: carteira.updatedAt
    };
  }

  @Post()
  async abrir(@Body() entrada: AbrirCarteiraDto) {

    const carteira = await this.servico.abrir(
      entrada.playerId,
      entrada.initialBalance
    );

    return this.serializar(carteira);
  }

  @Get(':walletId')
  async buscar(
    @Param('walletId', ParseUUIDPipe)
    carteiraId: string
  ) {

    const carteira = await this.servico.buscar(carteiraId);

    if (!carteira) {
      throw new NotFoundException('WALLET_NOT_FOUND');
    }

    return this.serializar(carteira);
  }

  @Post(':walletId/reconciliation')
  async reconciliar(
    @Param('walletId', ParseUUIDPipe)
    carteiraId: string
  ) {

    return this.servico.reconciliar(carteiraId);
  }

  @Get(':walletId/ledger')
  async buscarLedger(
    @Param('walletId', ParseUUIDPipe)
    carteiraId: string,

    @Query('cursor')
    cursor?: string,

    @Query('limit')
    limiteEntrada = '50'
  ) {

    const limite = Number(limiteEntrada);

    if (
      !Number.isInteger(limite) ||
      limite < 1 ||
      limite > 100
    ) {
      throw new BadRequestException('Limite invalido');
    }

    const carteira = await this.servico.buscar(carteiraId);

    if (!carteira) {
      throw new NotFoundException('WALLET_NOT_FOUND');
    }

    let dataCursor: string | null = null;
    let idCursor: string | null = null;

    if (cursor) {
      try {

        const dados = JSON.parse(
          Buffer.from(cursor, 'base64url').toString('utf8')
        );

        if (
          typeof dados.createdAt !== 'string' ||
          !Number.isFinite(Date.parse(dados.createdAt)) ||
          typeof dados.id !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dados.id)
        ) {
          throw new Error('Cursor invalido');
        }

        dataCursor = dados.createdAt;
        idCursor = dados.id;

      } catch {
        throw new BadRequestException('Cursor invalido');
      }
    }

    const registros = await banco.manager.query(`
      SELECT *,
        created_at::text AS cursor_date
      FROM wallet_ledger_entries
      WHERE wallet_id = $1
        AND (
          $2::timestamptz IS NULL
          OR (created_at, id) < ($2::timestamptz, $3::uuid)
        )
      ORDER BY created_at DESC, id DESC
      LIMIT $4
    `, [
      carteiraId,
      dataCursor,
      idCursor,
      limite + 1
    ]);

    const possuiMais = registros.length > limite;

    const itens = registros.slice(0, limite);

    const ultimo = itens[itens.length - 1];

    const proximoCursor = possuiMais && ultimo
      ? Buffer.from(JSON.stringify({
          createdAt: ultimo.cursor_date,
          id: ultimo.id
        })).toString('base64url')
      : null;

    return {
      items: itens.map((registro: any) => ({
        id: registro.id,
        walletId: registro.wallet_id,
        transactionId: registro.transaction_id,
        direction: DirecaoLancamento[registro.direction],
        money: {
          amount: registro.amount,
          currency: registro.currency
        },
        balanceBefore: {
          amount: registro.balance_before,
          currency: registro.currency
        },
        balanceAfter: {
          amount: registro.balance_after,
          currency: registro.currency
        },
        createdAt: registro.created_at
      })),
      nextCursor: proximoCursor
    };
  }
}