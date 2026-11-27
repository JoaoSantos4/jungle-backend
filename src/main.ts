import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

import {
  banco
} from './infraestrutura/banco/data-source';

import {
  ExcecaoFilter
} from './infraestrutura/http/filtros/excecao.filter';

async function bootstrap(): Promise<void> {
  await banco.initialize();
  const app = await NestFactory.create(AppModule);

  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true
    })
  );

  app.useGlobalFilters(new ExcecaoFilter());

  const porta = Number(process.env.PORT ?? '3000');

  await app.listen(porta);

  console.log(JSON.stringify({
    level: 'info',
    message: 'Aplicacao iniciada',
    port: porta
  }));
}

bootstrap().catch(() => {
  console.error('Falha ao iniciar aplicacao');
  process.exit(1);
});