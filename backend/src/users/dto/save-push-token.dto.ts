import { IsString, IsOptional } from 'class-validator';

export class SavePushTokenDto {
  @IsString()
  @IsOptional()
  expoPushToken?: string;
}
