import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';

import {
  banco
} from './infraestrutura/banco/data-source';

import {
  ExcecaoFilter
} from './infraestrutura/http/filtros/excecao.filter';

import {
  logger
} from './infraestrutura/observabilidade/logger';

async function bootstrap(): Promise<void> {

  await banco.initialize();

  const app = await NestFactory.create(
    AppModule,
    {
      bufferLogs: true
    }
  );

  app.useLogger(app.get(Logger));

  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    })
  );

  app.useGlobalFilters(new ExcecaoFilter());

  const porta = Number(
    process.env.PORT ?? '3000'
  );

  await app.listen(porta);

  logger.info({
    port: porta
  }, 'Aplicacao iniciada');
}

bootstrap().catch(() => {

  logger.fatal('Falha ao iniciar aplicacao');

  process.exit(1);
});