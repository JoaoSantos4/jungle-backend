import { banco } from '../../src/infraestrutura/banco/data-source';
import { PublisherService } from '../../src/infraestrutura/mensageria/publisher.service';

await banco.initialize();
const publisher = new PublisherService();
publisher.onApplicationBootstrap();
// O processo permanece ativo ate ser encerrado pelo teste.
await new Promise<void>(() => {});
