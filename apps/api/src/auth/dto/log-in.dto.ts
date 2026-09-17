import { IsEmail, IsString, MinLength, MaxLength } from "class-validator";

export class LogInDto {
  @IsEmail({}, { message: "Enter a valid email address." })
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
