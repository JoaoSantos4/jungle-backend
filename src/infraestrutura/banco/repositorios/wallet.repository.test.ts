import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll
} from 'bun:test';

import { banco } from '../data-source';
import { WalletRepository } from './wallet.repository';

import {
  Wallet
} from '../../../domain/entidades/wallet';

import {
  Money
} from '../../../domain/value-objects/money';

describe('WalletRepository - PostgreSQL', () => {

  beforeAll(async () => {
    await banco.initialize();
  });

  afterAll(async () => {
    if (banco.isInitialized) {
      await banco.destroy();
    }
  });

  test('Deve persistir e reconstruir carteira', async () => {

    await banco.transaction(async gerenciador => {

      const repositorio = new WalletRepository(
        gerenciador
      );

      const carteira = Wallet.open(
        crypto.randomUUID(),
        'BRL'
      );

      await repositorio.inserir(carteira);

      const encontrada = await repositorio.buscarPorId(
        carteira.id
      );

      expect(encontrada?.id).toBe(carteira.id);

      expect(encontrada?.balance.toJSON().amount)
        .toBe('0.00');
    });
  });

  test('Deve impedir bloqueio fora de transacao', async () => {

    const repositorio = new WalletRepository(
      banco.manager
    );

    await expect(
      repositorio.buscarComBloqueio(
        crypto.randomUUID()
      )
    ).rejects.toThrow('Bloqueio exige transacao ativa');
  });

  test('Deve impedir saldo negativo no banco', async () => {

    const carteira = Wallet.open(
      crypto.randomUUID(),
      'BRL'
    );

    await expect(
      banco.transaction(async gerenciador => {

        const repositorio = new WalletRepository(
          gerenciador
        );

        await repositorio.inserir(carteira);

        await gerenciador.query(`
          UPDATE wallets
          SET balance = $2
          WHERE id = $1
        `, [
          carteira.id,
          '-1.00'
        ]);
      })
    ).rejects.toThrow();

    const repositorio = new WalletRepository(
      banco.manager
    );

    expect(
      await repositorio.buscarPorId(carteira.id)
    ).toBeNull();
  });

  test('Deve impedir carteira duplicada', async () => {

    const jogadorId = crypto.randomUUID();

    await expect(
      banco.transaction(async gerenciador => {

        const repositorio = new WalletRepository(
          gerenciador
        );

        await repositorio.inserir(
          Wallet.open(jogadorId, 'BRL')
        );

        await repositorio.inserir(
          Wallet.open(jogadorId, 'BRL')
        );
      })
    ).rejects.toThrow();
  });

  test('Deve desfazer operacao apos falha', async () => {

    const carteira = Wallet.open(
      crypto.randomUUID(),
      'BRL'
    );

    await expect(
      banco.transaction(async gerenciador => {

        const repositorio = new WalletRepository(
          gerenciador
        );

        await repositorio.inserir(carteira);

        const encontrada =
          await repositorio.buscarComBloqueio(
            carteira.id
          );

        if (!encontrada) {
          throw new Error('Carteira nao encontrada');
        }

        encontrada.credit(Money.from({
          amount: '1.00',
          currency: 'BRL'
        }));

        await repositorio.atualizar(encontrada);

        throw new Error('Falha simulada');
      })
    ).rejects.toThrow('Falha simulada');

    const repositorio = new WalletRepository(
      banco.manager
    );

    expect(
      await repositorio.buscarPorId(carteira.id)
    ).toBeNull();
  });

});