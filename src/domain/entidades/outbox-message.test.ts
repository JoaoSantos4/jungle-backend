import { describe, test, expect } from 'bun:test';
import { OutboxMessage } from './outbox-message';

describe('OutboxMessage', () => {

  function criarEvento(): OutboxMessage {
    return OutboxMessage.enqueue({
      id: crypto.randomUUID(),
      aggregateId: crypto.randomUUID(),
      eventType: 'WalletBalanceChanged',
      occurredAt: new Date(),
      payload: {
        amount: '1.00',
        currency: 'BRL'
      }
    });
  }

  test('Deve iniciar evento pendente', () => {
    const evento = criarEvento();

    expect(evento.isPending()).toBe(true);
    expect(evento.attempts).toBe(0);
  });

  test('Deve estar disponivel para publicacao', () => {
    const evento = criarEvento();

    expect(evento.isDue()).toBe(true);
  });

  test('Deve marcar evento como publicado', () => {
    const evento = criarEvento();

    evento.markPublished();

    expect(evento.isPending()).toBe(false);
    expect(evento.publishedAt).toBeDefined();
    expect(evento.isDue()).toBe(false);
  });

  test('Deve agendar nova tentativa', () => {
    const evento = criarEvento();
    const agora = new Date();

    evento.scheduleRetry(agora);

    expect(evento.attempts).toBe(1);

    expect(evento.nextAttemptAt.getTime())
      .toBe(agora.getTime() + 1000);

    expect(evento.isDue(agora)).toBe(false);
  });

  test('Deve aumentar intervalo entre tentativas', () => {
    const evento = criarEvento();
    const agora = new Date();

    evento.scheduleRetry(agora);
    evento.scheduleRetry(agora);
    evento.scheduleRetry(agora);

    expect(evento.attempts).toBe(3);

    expect(evento.nextAttemptAt.getTime())
      .toBe(agora.getTime() + 4000);
  });

  test('Deve limitar intervalo em 60 segundos', () => {
    const evento = criarEvento();
    const agora = new Date();

    for (let i = 0; i < 20; i++) {
      evento.scheduleRetry(agora);
    }

    expect(evento.nextAttemptAt.getTime())
      .toBe(agora.getTime() + 60000);
  });

  test('Nao deve reagendar evento publicado', () => {
    const evento = criarEvento();

    evento.markPublished();

    expect(() => evento.scheduleRetry())
      .toThrow('Evento ja publicado');
  });

  test('Deve reconstruir evento persistido', () => {
    const original = criarEvento();

    original.scheduleRetry();

    const reconstruido = OutboxMessage.rehydrate(
      original.toProps()
    );

    expect(reconstruido.id).toBe(original.id);
    expect(reconstruido.attempts).toBe(1);

    expect(reconstruido.nextAttemptAt.getTime())
      .toBe(original.nextAttemptAt.getTime());
  });

  test('Nao deve permitir alterar payload original', () => {
    const evento = criarEvento();

    const payload = evento.payload;

    payload.amount = '999.00';

    expect(evento.payload.amount).toBe('1.00');
  });

});