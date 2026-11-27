import {
  Catch,
  HttpException
} from '@nestjs/common';

import type {
  ExceptionFilter,
  ArgumentsHost
} from '@nestjs/common';

@Catch()
export class ExcecaoFilter implements ExceptionFilter {

  catch(erro: unknown, contexto: ArgumentsHost): void {

    const resposta = contexto.switchToHttp().getResponse();

    if (erro instanceof HttpException) {

      resposta
        .status(erro.getStatus())
        .json(erro.getResponse());

      return;
    }

    const mensagem = erro instanceof Error
      ? erro.message
      : 'Erro desconhecido';

    const codigos: Record<string, number> = {
      WALLET_NOT_FOUND: 404,
      IDEMPOTENCY_CONFLICT: 409,
      CURRENCY_MISMATCH: 422,
      REFERENCE_REQUIRED: 400,
      'Saldo inicial invalido': 400,
      'Valor monetario invalido': 400,
      'Valor fora do limite monetario': 400,
      'Valor da transacao invalido': 400,
      'Valor da transacao deve ser positivo': 400,
      'Moeda invalida': 400,
      'Provedor reservado': 400,
      'Tipo de transacao invalido': 400
    };

    const erroBanco = erro as {
      code?: string;
      constraint?: string;
    };

    if (
      erroBanco?.code === '23505' &&
      erroBanco.constraint === 'uq_wallet_player_currency'
    ) {
      resposta.status(409).json({
        statusCode: 409,
        message: 'WALLET_ALREADY_EXISTS'
      });

      return;
    }

    const codigo = codigos[mensagem];

    if (codigo) {

      resposta.status(codigo).json({
        statusCode: codigo,
        message: mensagem
      });

      return;
    }

    const codigoBanco = erroBanco?.code ?? '';

    if (
      codigoBanco.startsWith('08') ||
      ['57P01', '40001', '40P01', 'ECONNREFUSED', 'ETIMEDOUT']
        .includes(codigoBanco)
    ) {

      resposta.status(503).json({
        statusCode: 503,
        message: 'SERVICE_UNAVAILABLE'
      });

      return;
    }

    console.error(JSON.stringify({
      level: 'error',
      message: 'Falha interna no processamento'
    }));

    resposta.status(500).json({
      statusCode: 500,
      message: 'INTERNAL_SERVER_ERROR'
    });
  }
}