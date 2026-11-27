import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsIn,
  IsOptional,
  IsDefined,
  ValidateNested,
  MaxLength,
  ValidateIf
} from 'class-validator';

import { Type } from 'class-transformer';
import { MoneyDto } from './money.dto';

import type {
  TipoTransacaoExterna
} from '../../../aplicacao/contratos/transacao.dto';

export class ProcessarTransacaoDto {

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  providerId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  externalTransactionId!: string;

  @IsUUID()
  playerId!: string;

  @IsUUID()
  walletId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  roundId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  gameId!: string;

  @IsIn(['BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK'])
  kind!: TipoTransacaoExterna;

  @IsDefined()
  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;

  @ValidateIf(objeto =>
    objeto.kind === 'REFUND' ||
    objeto.kind === 'ROLLBACK' ||
    objeto.referenceExternalTransactionId !== undefined
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  referenceExternalTransactionId?: string;
}