import 'reflect-metadata';
import { DataSource } from 'typeorm';

import {
  CriarTabelas1795737600000
} from './migrations/1795737600000-criar-tabelas';

export const banco = new DataSource({
  type: 'postgres',

  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? '5432'),
  username: process.env.DB_USER ?? 'jungle',
  password: process.env.DB_PASSWORD ?? 'jungle_dev',
  database: process.env.DB_NAME ?? 'jungle',

  synchronize: false,
  logging: false,

  migrations: [
    CriarTabelas1795737600000
  ],

  migrationsTableName: 'migrations',

  extra: {
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000
  }
});