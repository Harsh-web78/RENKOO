import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as crypto from "crypto";

/**
 * TokenEncryptionService — AES-256-GCM authenticated encryption for OAuth tokens.
 *
 * Spec §5.2: GOOGLE_TOKEN_ENCRYPTION_KEY is a base64-encoded 32-byte key (256 bits).
 * Each encryption uses a fresh 12-byte IV (nonce). Ciphertext is stored as
 * base64(iv || authTag || ciphertext) with 16-byte tag. Decryption validates tag
 * via GCM — tampered ciphertext throws.
 *
 * keyVersion is stored alongside ciphertext in DB (SearchConsoleConnection.keyVersion)
 * to support future rotation. Current version is 1. Decrypt tries current key;
 * if it fails and old keys are configured via GOOGLE_TOKEN_ENCRYPTION_KEY_OLD,
 * it would try those (not needed in Prompt 8, but structure is there).
 *
 * Never log plaintext tokens.
 */
@Injectable()
export class TokenEncryptionService implements OnModuleInit {
  private readonly logger = new Logger(TokenEncryptionService.name);
  private key!: Buffer;
  private readonly keyVersion = 1;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const rawKey = this.config.get<string>("GOOGLE_TOKEN_ENCRYPTION_KEY");
    const nodeEnv = this.config.get<string>("NODE_ENV", "development");
    if (!rawKey) {
      // Fail fast in production: silently encrypting with a well-known dev
      // key would expose every stored Google token. Development/test keep a
      // placeholder so local runs and CI work without secrets.
      if (nodeEnv === "production") {
        throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY is required in production (base64-encoded 32-byte key)");
      }
      // In test/development, allow placeholder default — see env.validation default
      // If not provided, generate a deterministic dev key (not for production)
      const devKey = Buffer.alloc(32, 0x01).toString("base64");
      this.logger.warn("GOOGLE_TOKEN_ENCRYPTION_KEY not set, using dev placeholder (not production-safe)");
      this.key = Buffer.from(devKey, "base64");
      this.validateKey(this.key);
      return;
    }
    try {
      this.key = Buffer.from(rawKey, "base64");
    } catch {
      throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be base64-encoded");
    }
    this.validateKey(this.key);
  }

  private validateKey(key: Buffer): void {
    if (key.length !== 32) {
      throw new Error(
        `GOOGLE_TOKEN_ENCRYPTION_KEY must decode to 32 bytes for AES-256-GCM, got ${key.length} bytes`,
      );
    }
  }

  getKeyVersion(): number {
    return this.keyVersion;
  }

  /**
   * Encrypt plaintext UTF-8 string. Returns base64(iv + authTag + ciphertext).
   * IV is 12 bytes, authTag 16 bytes (GCM).
   */
  encrypt(plaintext: string): string {
    if (typeof plaintext !== "string") {
      throw new Error("encrypt expects string");
    }
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const enc1 = cipher.update(plaintext, "utf8");
    const enc2 = cipher.final();
    const ciphertext = Buffer.concat([enc1, enc2]);
    const authTag = cipher.getAuthTag(); // 16 bytes
    const combined = Buffer.concat([iv, authTag, ciphertext]);
    return combined.toString("base64");
  }

  /**
   * Decrypt base64(iv + authTag + ciphertext). Throws if tampered or wrong key.
   */
  decrypt(encryptedBase64: string): string {
    const combined = Buffer.from(encryptedBase64, "base64");
    if (combined.length < 12 + 16 + 1) {
      throw new Error("Invalid encrypted payload: too short");
    }
    const iv = combined.subarray(0, 12);
    const authTag = combined.subarray(12, 28);
    const ciphertext = combined.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(authTag);
    const dec1 = decipher.update(ciphertext);
    const dec2 = decipher.final();
    const plaintext = Buffer.concat([dec1, dec2]).toString("utf8");
    return plaintext;
  }
}
