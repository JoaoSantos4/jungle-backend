import {
  IsUUID,
  IsDefined,
  ValidateNested
} from 'class-validator';

import { Type } from 'class-transformer';
import { MoneyDto } from './money.dto';

export class AbrirCarteiraDto {

  @IsUUID()
  playerId!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => MoneyDto)
  initialBalance!: MoneyDto;
}