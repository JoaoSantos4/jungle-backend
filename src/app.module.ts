import { Module } from '@nestjs/common';

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

@Module({
  controllers: [
    CarteiraController,
    TransacaoController,
    HealthController
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