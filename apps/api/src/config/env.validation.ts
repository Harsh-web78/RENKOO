import * as Joi from "joi";

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid("development", "production", "test")
    .default("development"),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string()
    .uri()
    .required()
    .description("PostgreSQL connection string, e.g. postgresql://user:pass@db:5432/renko"),
  REDIS_URL: Joi.string()
    .uri({ scheme: ["redis", "rediss"] })
    .required()
    .description("Redis connection string, e.g. redis://redis:6379"),
  FRONTEND_URL: Joi.string().uri().default("http://localhost:3001"),
  SESSION_SECRET: Joi.string().min(32).default("dev-only-session-secret-change-in-production-32chars"),
  SESSION_MAX_AGE_MS: Joi.number().default(7 * 24 * 60 * 60 * 1000),
  GOOGLE_CLIENT_ID: Joi.string()
    .pattern(/\.apps\.googleusercontent\.com$/)
    .allow("")
    .default("")
    .description("Google OAuth client ID (from Cloud Console)"),
  GOOGLE_CLIENT_SECRET: Joi.string().allow("").default(""),
  GOOGLE_REDIRECT_URI: Joi.string().uri().allow("").default(""),
  GOOGLE_TOKEN_ENCRYPTION_KEY: Joi.string()
    .custom((value: string, helpers) => {
      if (!value || value === "") return value;
      try {
        const buf = Buffer.from(value, "base64");
        if (buf.length !== 32) {
          return helpers.error("any.invalid", { message: "must decode to 32 bytes" });
        }
        return value;
      } catch {
        return helpers.error("any.invalid");
      }
    })
    .allow("")
    .default("")
    .description("Base64-encoded 32-byte AES-256-GCM key"),
  GOOGLE_TOKEN_ENDPOINT: Joi.string().uri().default("https://oauth2.googleapis.com/token"),
  GOOGLE_AUTH_ENDPOINT: Joi.string().uri().default("https://accounts.google.com/o/oauth2/v2/auth"),
  GOOGLE_REVOKE_ENDPOINT: Joi.string().uri().default("https://oauth2.googleapis.com/revoke"),
  GOOGLE_USERINFO_ENDPOINT: Joi.string().uri().default("https://www.googleapis.com/oauth2/v2/userinfo"),
  GSC_MOCK: Joi.string().valid("true", "false").default("true"),
  GSC_SITES_ENDPOINT: Joi.string().uri().default("https://www.googleapis.com/webmasters/v3/sites"),
});
