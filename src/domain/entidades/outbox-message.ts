export interface OutboxMessageProps {
  id: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  attempts: number;
  nextAttemptAt: Date;
  publishedAt?: Date;
}

export type CriarOutboxProps = Pick<
  OutboxMessageProps,
  'id' | 'aggregateId' | 'eventType' |
  'payload' | 'occurredAt'
>;

export class OutboxMessage {
  private constructor(
    private readonly dados: OutboxMessageProps
  ) {}

  static enqueue(
    props: CriarOutboxProps
  ): OutboxMessage {
    if (
      !props.id.trim() ||
      !props.aggregateId.trim() ||
      !props.eventType.trim()
    ) {
      throw new Error('Dados do evento invalidos');
    }

    return new OutboxMessage({
      ...props,
      payload: structuredClone(props.payload),
      occurredAt: new Date(props.occurredAt),
      attempts: 0,
      nextAttemptAt: new Date()
    });
  }

  static rehydrate(
    props: OutboxMessageProps
  ): OutboxMessage {
    return new OutboxMessage(
      structuredClone(props)
    );
  }

  isPending(): boolean {
    return this.dados.publishedAt === undefined;
  }

  isDue(agora = new Date()): boolean {
    return (
      this.isPending() &&
      this.dados.nextAttemptAt.getTime() <= agora.getTime()
    );
  }

  markPublished(): void {
    if (!this.isPending()) {
      return;
    }

    this.dados.publishedAt = new Date();
  }

  scheduleRetry(agora = new Date()): void {
    if (!this.isPending()) {
      throw new Error('Evento ja publicado');
    }

    this.dados.attempts++;

    const segundos = Math.min(
      2 ** Math.min(this.dados.attempts - 1, 6),
      60
    );

    this.dados.nextAttemptAt = new Date(
      agora.getTime() + segundos * 1000
    );
  }

  get id(): string {
    return this.dados.id;
  }

  get aggregateId(): string {
    return this.dados.aggregateId;
  }

  get eventType(): string {
    return this.dados.eventType;
  }

  get payload(): Record<string, unknown> {
    return structuredClone(this.dados.payload);
  }

  get attempts(): number {
    return this.dados.attempts;
  }

  get occurredAt(): Date {
    return new Date(this.dados.occurredAt);
  }

  get nextAttemptAt(): Date {
    return new Date(this.dados.nextAttemptAt);
  }

  get publishedAt(): Date | undefined {
    return this.dados.publishedAt
      ? new Date(this.dados.publishedAt)
      : undefined;
  }

  toProps(): OutboxMessageProps {
    return structuredClone(this.dados);
  }
}