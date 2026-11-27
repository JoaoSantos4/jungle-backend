export interface InboxMessageProps {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: Date;
  processedAt?: Date;
}

export type ReceberMensagemProps = Omit<
  InboxMessageProps,
  'receivedAt' | 'processedAt'
>;

export class InboxMessage {
  private constructor(
    private readonly dados: InboxMessageProps
  ) {}

  static receive(
    props: ReceberMensagemProps
  ): InboxMessage {
    if (
      !props.messageId.trim() ||
      !props.consumerName.trim() ||
      !props.payloadHash.trim()
    ) {
      throw new Error('Dados da mensagem invalidos');
    }

    return new InboxMessage({
      ...props,
      receivedAt: new Date()
    });
  }

  static rehydrate(
    props: InboxMessageProps
  ): InboxMessage {
    return new InboxMessage({
      ...props,
      receivedAt: new Date(props.receivedAt),
      processedAt: props.processedAt
        ? new Date(props.processedAt)
        : undefined
    });
  }

  isProcessed(): boolean {
    return this.dados.processedAt !== undefined;
  }

  matchesPayload(hash: string): boolean {
    return this.dados.payloadHash === hash;
  }

  markProcessed(): void {
    if (this.isProcessed()) {
      return;
    }

    this.dados.processedAt = new Date();
  }

  get messageId(): string {
    return this.dados.messageId;
  }

  get consumerName(): string {
    return this.dados.consumerName;
  }

  get payloadHash(): string {
    return this.dados.payloadHash;
  }

  get receivedAt(): Date {
    return new Date(this.dados.receivedAt);
  }

  get processedAt(): Date | undefined {
    return this.dados.processedAt
      ? new Date(this.dados.processedAt)
      : undefined;
  }

  toProps(): InboxMessageProps {
    return {
      ...this.dados,
      receivedAt: this.receivedAt,
      processedAt: this.processedAt
    };
  }
}