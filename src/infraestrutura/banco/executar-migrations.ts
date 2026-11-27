import { banco } from './data-source';

async function executar(): Promise<void> {
  try {
    await banco.initialize();

    const migrations = await banco.runMigrations();

    console.log(
      'Migrations executadas:',
      migrations.map(migration => migration.name)
    );

  } catch (erro) {
    console.error('Erro ao executar migrations:', erro);
    process.exitCode = 1;

  } finally {
    if (banco.isInitialized) {
      await banco.destroy();
    }
  }
}

void executar();