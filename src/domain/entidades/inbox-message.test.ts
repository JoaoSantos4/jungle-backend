import { describe, test, expect } from 'bun:test';
import { InboxMessage } from './inbox-message';

describe('InboxMessage', () => {

  function criarMensagem(): InboxMessage {
    return InboxMessage.receive({
      messageId: crypto.randomUUID(),
      consumerName: 'wager-consumer',
      payloadHash: 'hash-teste'
    });
  }

  test('Deve receber mensagem pendente', () => {
    const mensagem = criarMensagem();

    expect(mensagem.isProcessed()).toBe(false);
    expect(mensagem.processedAt).toBeUndefined();
  });

  test('Deve marcar mensagem como processada', () => {
    const mensagem = criarMensagem();

    mensagem.markProcessed();

    expect(mensagem.isProcessed()).toBe(true);
    expect(mensagem.processedAt).toBeDefined();
  });

  test('Nao deve alterar processamento anterior', () => {
    const mensagem = criarMensagem();

    mensagem.markProcessed();

    const data = mensagem.processedAt?.getTime();

    mensagem.markProcessed();

    expect(mensagem.processedAt?.getTime()).toBe(data);
  });

  test('Deve identificar payload igual', () => {
    const mensagem = criarMensagem();

    expect(mensagem.matchesPayload('hash-teste'))
      .toBe(true);
  });

  test('Deve identificar payload divergente', () => {
    const mensagem = criarMensagem();

    expect(mensagem.matchesPayload('outro-hash'))
      .toBe(false);
  });

  test('Deve reconstruir mensagem processada', () => {
    const original = criarMensagem();

    original.markProcessed();

    const reconstruida = InboxMessage.rehydrate(
      original.toProps()
    );

    expect(reconstruida.messageId)
      .toBe(original.messageId);

    expect(reconstruida.isProcessed()).toBe(true);
  });

  test('Nao deve aceitar identificador vazio', () => {
    expect(() => InboxMessage.receive({
      messageId: '',
      consumerName: 'wager-consumer',
      payloadHash: 'hash-teste'
    })).toThrow('Dados da mensagem invalidos');
  });

});