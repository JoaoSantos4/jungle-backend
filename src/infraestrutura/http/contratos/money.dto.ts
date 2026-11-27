import {
  IsString,
  Matches,
  IsIn
} from 'class-validator';

export class MoneyDto {

  @IsString()
  @Matches(/^\d{1,18}(\.\d{1,2})?$/)
  amount!: string;

  @IsString()
  @IsIn(['BRL'])
  currency!: string;
}