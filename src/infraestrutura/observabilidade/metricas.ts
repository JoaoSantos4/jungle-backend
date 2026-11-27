import {
  Registry,
  Counter,
  Gauge,
  Histogram,
  collectDefaultMetrics
} from 'prom-client';

export const registroMetricas = new Registry();

collectDefaultMetrics({
  register: registroMetricas,
  prefix: 'jungle_'
});

export const transacoesProcessadas = new Counter({
  name: 'jungle_transactions_total',
  help: 'Quantidade de transacoes por status',
  labelNames: ['status'] as const,
  registers: [registroMetricas]
});

export const mensagensDuplicadas = new Counter({
  name: 'jungle_duplicate_messages_total',
  help: 'Quantidade de mensagens duplicadas',
  registers: [registroMetricas]
});

export const transacoesDuplicadas = new Counter({
  name: 'jungle_idempotent_replays_total',
  help: 'Quantidade de replays idempotentes',
  registers: [registroMetricas]
});

export const tentativasProcessamento = new Counter({
  name: 'jungle_retries_total',
  help: 'Quantidade de novas tentativas',
  labelNames: ['origem'] as const,
  registers: [registroMetricas]
});

export const conflitosBloqueio = new Counter({
  name: 'jungle_lock_conflicts_total',
  help: 'Quantidade de conflitos de bloqueio',
  registers: [registroMetricas]
});

export const mensagensDlq = new Gauge({
  name: 'jungle_dlq_messages',
  help: 'Quantidade aproximada de mensagens na DLQ',
  registers: [registroMetricas]
});

export const eventosPendentes = new Gauge({
  name: 'jungle_outbox_pending',
  help: 'Quantidade de eventos pendentes no outbox',
  registers: [registroMetricas]
});

export const atrasoOutbox = new Gauge({
  name: 'jungle_outbox_lag_seconds',
  help: 'Idade do evento pendente mais antigo em segundos',
  registers: [registroMetricas]
});

export const latenciaProcessamento = new Histogram({
  name: 'jungle_processing_duration_seconds',
  help: 'Duracao do processamento em segundos',
  labelNames: ['origem'] as const,
  buckets: [
    0.005,
    0.01,
    0.025,
    0.05,
    0.1,
    0.25,
    0.5,
    1,
    2,
    5
  ],
  registers: [registroMetricas]
});

export const disponibilidade = new Gauge({
  name: 'jungle_health_status',
  help: 'Disponibilidade da aplicacao e dependencias',
  labelNames: ['componente'] as const,
  registers: [registroMetricas]
});

export const divergenciasFinanceiras = new Counter({
  name: 'jungle_reconciliation_mismatches_total',
  help: 'Quantidade de divergencias financeiras encontradas',
  registers: [registroMetricas]
});