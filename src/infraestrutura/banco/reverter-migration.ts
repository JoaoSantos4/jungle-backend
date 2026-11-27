import { banco } from './data-source';

async function reverter(): Promise<void> {
  try {
    await banco.initialize();

    await banco.undoLastMigration();

    console.log('Migration revertida com sucesso');

  } catch (erro) {
    console.error('Erro ao reverter migration:', erro);
    process.exitCode = 1;

  } finally {
    if (banco.isInitialized) {
      await banco.destroy();
    }
  }
}

void reverter();