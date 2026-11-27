import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';

import {
  CarteiraController
} from './infraestrutura/http/controllers/carteira.controller';

import {
  TransacaoController
} from './infraestrutura/http/controllers/transacao.controller';

import {
  HealthController
} from './infraestrutura/http/controllers/health.controller';

import {
  MetricasController
} from './infraestrutura/observabilidade/metricas.controller';

import {
  CarteiraService
} from './aplicacao/servicos/carteira.service';

import {
  TransacaoService
} from './aplicacao/servicos/transacao.service';

import {
  InboxService
} from './aplicacao/servicos/inbox.service';

import {
  ConsumidorService
} from './infraestrutura/mensageria/consumidor.service';

import {
  PublisherService
} from './infraestrutura/mensageria/publisher.service';

import {
  ReferenciaPendenteService
} from './infraestrutura/workers/referencia-pendente.service';

import {
  logger
} from './infraestrutura/observabilidade/logger';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        logger,

        genReqId: () => crypto.randomUUID(),

        serializers: {
          req: requisicao => ({
            id: requisicao.id,
            method: requisicao.method
          }),

          res: resposta => ({
            statusCode: resposta.statusCode
          })
        }
      }
    })
  ],

  controllers: [
    CarteiraController,
    TransacaoController,
    HealthController,
    MetricasController
  ],

  providers: [
    CarteiraService,
    TransacaoService,
    InboxService,
    ConsumidorService,
    PublisherService,
    ReferenciaPendenteService
  ]
})
export class AppModule {}