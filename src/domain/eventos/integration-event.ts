export interface EventContext {
  correlationId: string;
  causationId?: string;
}

export interface IntegrationEventProps<T> {
  eventId: string;
  aggregateId: string;
  correlationId: string;
  causationId?: string;
  occurredAt: Date;
  data: T;
}

export abstract class IntegrationEvent<T> {
  abstract readonly eventType: string;
  abstract readonly version: number;

  readonly eventId: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId?: string;

  private readonly dataOcorrencia: Date;
  private readonly dados: T;

  protected constructor(props: IntegrationEventProps<T>) {
    this.eventId = props.eventId;
    this.aggregateId = props.aggregateId;
    this.correlationId = props.correlationId;
    this.causationId = props.causationId;
    this.dataOcorrencia = new Date(props.occurredAt);
    this.dados = structuredClone(props.data);
  }

  get occurredAt(): Date {
    return new Date(this.dataOcorrencia);
  }

  get data(): T {
    return structuredClone(this.dados);
  }

  toJSON() {
    return {
      eventId: this.eventId,
      eventType: this.eventType,
      version: this.version,
      aggregateId: this.aggregateId,
      correlationId: this.correlationId,
      causationId: this.causationId,
      occurredAt: this.occurredAt.toISOString(),
      data: this.data
    };
  }
}