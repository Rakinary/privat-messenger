import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateMessageDto {
  @IsString()
  chatId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  text?: string;

  @IsOptional()
  @IsString()
  attachmentId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['text', 'image', 'video', 'gif', 'file', 'system'])
  type?: 'text' | 'image' | 'video' | 'gif' | 'file' | 'system';
}
