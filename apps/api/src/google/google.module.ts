import { Module } from "@nestjs/common";
import { GoogleOAuthController } from "./google-oauth.controller";
import { ConnectionsController } from "./connections.controller";
import { GoogleOAuthService } from "./google-oauth.service";
import { TokenEncryptionService } from "./token-encryption.service";

@Module({
  controllers: [GoogleOAuthController, ConnectionsController],
  providers: [GoogleOAuthService, TokenEncryptionService],
  exports: [GoogleOAuthService, TokenEncryptionService],
})
export class GoogleModule {}
