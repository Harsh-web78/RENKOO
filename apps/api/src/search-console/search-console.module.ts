import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";
import { TokenEncryptionService } from "../google/token-encryption.service";
import { SEARCH_CONSOLE_PROVIDER } from "./search-console.provider";
import { GscSearchConsoleProvider } from "./gsc-search-console.provider";
import { InMemoryMockSearchConsoleProvider } from "./in-memory-mock.provider";
import { SearchConsoleService } from "./search-console.service";

@Module({
  imports: [PrismaModule],
  providers: [
    TokenEncryptionService,
    SearchConsoleService,
    {
      provide: SEARCH_CONSOLE_PROVIDER,
      useFactory: (config: ConfigService, prisma: PrismaService, encryption: TokenEncryptionService) => {
        const useMock = config.get<string>("GSC_MOCK", "true") === "true";
        if (useMock) {
          return new InMemoryMockSearchConsoleProvider();
        }
        return new GscSearchConsoleProvider(config, prisma, encryption);
      },
      inject: [ConfigService, PrismaService, TokenEncryptionService],
    },
  ],
  exports: [SearchConsoleService, SEARCH_CONSOLE_PROVIDER],
})
export class SearchConsoleModule {}
