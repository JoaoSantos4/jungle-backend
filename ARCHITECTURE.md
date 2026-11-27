Arquitetura: 
  Objetivo e organização! 
    O serviço processa operações financeiras de apostas de múltiplos provedores, preservando saldo, histórico e idempotência mesmo com concorrência e redelivery! A arquitetura separa domínio, aplicação e infraestrutura, seguindo uma abordagem DDD simplificada. HTTP e SQS compartilham o serviço de transações; PostgreSQL é a fonte de verdade.

Domínio e dinheiro:
  Wallet é a raiz do agregado financeiro. Money encapsula decimal.js, moeda e operações monetárias, evitando aritmética financeira com number. A persistência utiliza NUMERIC(20,2), com conversão explícita de strings para Money nos repositórios. A API serializa valores em strings decimais. BRL é a moeda operacional; moedas divergentes são rejeitadas. Entidades usam factories para criação e reidratação, separando reconstrução de transições de negócio.    

Operação --- Efeito
  OPENING = Crédito inicial interno, quando positivo
  BET = Débito, sujeito a saldo suficiente
  WIN = Crédito; referência opcional a BET
  LOSS = Sem movimentação financeira
  REFUND = Crédito referente a BET processado
  ROLLBACK = Inversão de BET, WIN ou REFUND processado

  Reversões exigem referência, mesmo escopo (provedor, jogador, carteira, rodada e moeda), valor correspondente e ausência de reversão anterior. A implementação impede REFUND e ROLLBACK concorrentes sobre a mesma operação original, além de impedir repetição do mesmo tipo. Uma reversão que exigiria saldo negativo é rejeitada. Transações rejeitadas não geram lançamento financeiro.

Persistência e concorrência:
  TypeORM foi escolhido pela integração com PostgreSQL, migrations reversíveis e controle explícito de transações via EntityManager. Os repositórios utilizam SQL explícito para tornar visíveis os bloqueios e as constraints. Não há synchronize automático.
  Cada operação financeira bloqueia a linha da carteira com SELECT FOR UPDATE dentro da transação SQL. O mesmo gerenciador é utilizado para atualizar carteira, transação, ledger e outbox. Operações da mesma carteira são serializadas pelo banco, inclusive entre processos independentes; carteiras diferentes não compartilham um bloqueio global. A versão da carteira acompanha alterações de saldo.
  A estratégia pessimista simplifica a garantia de saldo não negativo, ao custo de espera em carteiras muito disputadas. O pool de conexões é limitado a dez por processo. Deadlocks, falhas de conexão e outros erros transitórios podem exigir nova tentativa; o cliente HTTP deve repetir com a mesma chave.
  O banco impõe unicidade de carteira por jogador/moeda, chaves de transação por provedor, lançamento por carteira/transação e reversão processada do mesmo tipo. CHECKs protegem saldo, valores e cálculo do ledger. Triggers impedem UPDATE, DELETE e TRUNCATE do ledger. A aplicação não utiliza o ledger como tabela editável.

Idempotência:
  A identidade da operação é persistida por provedor e identificador externo, além da chave de idempotência. Um hash SHA-256 do conteúdo de negócio normalizado permite detectar reutilização com payload divergente. Replays retornam a transação existente e o saldo de resultado persistido, não executam uma segunda movimentação. Uma operação pendente pode posteriormente apresentar seu resultado terminal.
  No SQS, o Inbox utiliza a chave composta consumer_name/message_id e hash do envelope. O registro de processamento e os efeitos financeiros são confirmados na mesma transação. Uma mensagem repetida com conteúdo divergente não é tratada como replay válido. O mecanismo não depende da janela de deduplicação FIFO.

Ledger e reconciliação: 
  O saldo materializado permite leitura eficiente. O ledger append-only mantém direção, valor e saldos anterior/posterior. A abertura positiva cria transação OPENING e lançamento na mesma transação; abertura zero não gera lançamento. LOSS e rejeições não movimentam saldo.
  A reconciliação utiliza REPEATABLE READ para comparar saldo armazenado e soma dos lançamentos em um snapshot consistente. Divergências são reportadas por log e métrica, sem correção automática. Não foi implementada contabilidade de partidas dobradas.

Mensageria e recuperação:
  O consumidor utiliza long polling de 20 segundos e visibilidade inicial de 30 segundos. O ACK (DeleteMessage) ocorre após commit. Falhas provocam nova tentativa com ajuste de visibilidade e backoff limitado a 60 segundos; a política de redrive encaminha mensagens não confirmadas à DLQ após o limite configurado de cinco recebimentos. Rejeições de negócio persistidas e referências pendentes podem ser confirmadas sem aguardar resolução futura. Mensagens inválidas seguem o mecanismo de redrive, em vez de publicação direta na DLQ.
  Se um processo cair antes do commit, o PostgreSQL desfaz a transação. Se cair depois do commit e antes do ACK, a próxima entrega encontra o Inbox persistido. O shutdown interrompe novas buscas e aguarda o processamento em andamento; uma interrupção forçada depende da visibilidade da fila para recuperação.

Referências pendentes:
  REFUND e ROLLBACK sem referência disponível são persistidos como PENDING_REFERENCE. O worker busca registros elegíveis, bloqueia a carteira e verifica novamente o estado da transação. O próximo horário e número de tentativas são persistidos, com backoff exponencial limitado a 60 segundos e expiração de 24 horas. A expiração gera rejeição com código específico. O prazo é fixado no SQL atual; torná-lo configurável é uma evolução possível.

Transactional Outbox:
  Eventos são persistidos junto com a operação financeira, nunca publicados antes do commit financeiro. São utilizados WagerTransactionProcessed, WagerTransactionRejected, WagerTransactionPendingReference e WalletBalanceChanged. O último representa alteração efetiva de saldo. Eventos possuem envelope com identificador, tipo, versão, agregado, correlação, data e dados serializados.
  Publishers selecionam mensagens elegíveis com FOR UPDATE SKIP LOCKED, em lotes de uma mensagem. O bloqueio da linha do outbox é mantido durante a chamada SQS com timeout limitado. Isso simplifica a coordenação entre publishers, mas mantém uma conexão SQL ocupada durante I/O. Em falha, o próximo horário de tentativa é persistido; o retry usa backoff limitado a 60 segundos. Não há descarte automático de eventos por número de tentativas.
  Se o envio ocorrer e a confirmação SQL falhar, o evento pode ser publicado novamente. A garantia é at-least-once, não exactly-once. O eventId permanece estável e deve ser 
  usado pelos consumidores downstream para deduplicação persistente. O serviço não implementa esses consumidores externos.

Observabilidade: 
  Pino produz logs JSON com identificação de instância e, quando disponíveis, correlationId, messageId, transactionId, walletId e providerId. Não é necessário registrar o payload financeiro completo. Prometheus expõe contadores de transações por status, duplicidades, retries, conflitos SQL de bloqueio, divergências de reconciliação, latência e gauges de DLQ, outbox e disponibilidade. Os contadores são locais ao processo; devem ser coletados por instância. As métricas não são fonte de verdade financeira e podem perder incrementos em uma interrupção imediatamente após commit. Conflitos de bloqueio representam erros SQL específicos, não toda espera por locks.
  Liveness indica disponibilidade do processo; readiness verifica PostgreSQL e SQS. A propagação integral de correlationId entre todos os caminhos HTTP e workers não foi demonstrada. Não foram implementados dashboards ou tracing distribuído.

Autenticação e segurança:
  Autenticação não foi implementada. A API é destinada ao ambiente local do desafio, não à exposição pública. O ponto de extensão proposto é um Guard NestJS na camada HTTP, antes dos controllers de operações protegidas, com um adaptador de identidade que associe o principal autenticado ao providerId. Uma futura implementação deve utilizar um IdP externo (por exemplo Keycloak), OAuth2 client credentials, validação de assinatura, emissor, audiência e expiração do token, além de autorização por provedor. Health pode permanecer público. A fila interna deve ser protegida por IAM e o produtor autorizado deve vincular a identidade ao provedor. Esse Guard/adaptador é uma proposta, não um componente já implementado.

Validação e limitações:
  A suíte cobre operações financeiras, idempotência, constraints, reconciliação, concorrência, referências fora de ordem e processos independentes. Os testes de recuperação utilizam processos auxiliares com Inbox real e SQS local; a interrupção após commit e antes do ACK não é injetada no consumidor de produção completo. O teste de DLQ simula entregas não confirmadas em filas isoladas. Os testes de publishers verificam confirmação persistida, não ausência de duplicatas na fila. LocalStack não substitui validação em AWS real. Não há teste de carga formal nem certificação de produção.
  Para produção seriam necessários, entre outros pontos, autenticação/autorização, gestão de segredos, TLS, políticas IAM, backup e recuperação do PostgreSQL, alertas, estratégia operacional de DLQ e testes de indisponibilidade prolongada. A imutabilidade do ledger pressupõe que a conta da aplicação não possa remover triggers ou alterar o schema; separar permissões de migration e runtime é uma melhoria de implantação.