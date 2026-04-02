import { IsIn, IsOptional, IsString } from 'class-validator';

export class SetReactionDto {
  @IsOptional()
  @IsString()
  @IsIn(['❤️', '👍', '😂', '😮', '🔥'])
  emoji?: '❤️' | '👍' | '😂' | '😮' | '🔥';
}