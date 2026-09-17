import { IsEmail, IsString, MinLength, IsOptional, MaxLength } from "class-validator";

export class SignUpDto {
  @IsEmail({}, { message: "Enter a valid email address." })
  email!: string;

  @IsString()
  @MinLength(8, { message: "The password must contain at least 8 characters." })
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  workspaceName?: string;
}
