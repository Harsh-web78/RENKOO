import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import cookieParser from "cookie-parser";
import session from "express-session";
import { RedisStore } from "connect-redis";
import { createClient } from "redis";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  const nodeEnv = config.get<string>("NODE_ENV", "development");
  const isProd = nodeEnv === "production";
  const port = Number(config.get<number>("PORT", 3000));
  const frontendUrl = config.get<string>("FRONTEND_URL", "http://localhost:3001");
  const sessionSecret = config.get<string>("SESSION_SECRET")!;
  const sessionMaxAge = Number(config.get<number>("SESSION_MAX_AGE_MS", 7 * 24 * 60 * 60 * 1000));
  const redisUrl = config.get<string>("REDIS_URL")!;

  // Fail fast in production: the distributed default session secret is
  // public knowledge — booting prod with it would let anyone forge
  // session cookies. Development/test keep the default for convenience.
  if (isProd && sessionSecret === "dev-only-session-secret-change-in-production-32chars") {
    throw new Error("SESSION_SECRET must be set to a strong random value in production");
  }

  // Trust proxy is required for Secure cookies behind a proxy (Caddy/Nginx) in production.
  // In dev we also set trust proxy to handle loopback correctly when Secure=false.
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set("trust proxy", 1);

  app.use(cookieParser());

  // Redis client for sessions — node-redis (official `redis` package) is the
  // only client supported by connect-redis@10 (peer `redis >= 5`). ioredis
  // uses a variadic SET form (`SET k v EX ttl`) while connect-redis@10 emits
  // the node-redis options form (`SET k v { expiration: { type: "EX",
  // value: ttl } }`); passing an ioredis client therefore writes
  // `SET sess:<id> <json> [object Object]` → `ERR syntax error` and breaks
  // session persistence. ioredis@6 remains in use for BullMQ/GSC QPM only.
  // In tests we fallback to MemoryStore.
  let redisClient: ReturnType<typeof createClient> | null = null;
  let sessionStore:
    | InstanceType<typeof RedisStore>
    | session.MemoryStore
    | undefined;

  if (nodeEnv === "test") {
    // In tests we use MemoryStore for speed; e2e tests override with real Redis if needed.
    sessionStore = new session.MemoryStore();
  } else {
    try {
      redisClient = createClient({ url: redisUrl });
      redisClient.on("error", (err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn("[session] Redis error:", err);
      });
      // Attempt to connect but don't block bootstrap; failures are logged.
      redisClient.connect().catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.warn("[session] Redis connect failed, sessions will fail until Redis recovers:", err);
      });
      sessionStore = new RedisStore({
        client: redisClient as any,
        prefix: "sess:",
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[session] Redis initialization failed, falling back to MemoryStore:", err);
      sessionStore = new session.MemoryStore();
    }
  }

  app.use(
    session({
      name: "renko.sid",
      secret: sessionSecret,
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      rolling: false,
      proxy: isProd,
      cookie: {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        maxAge: sessionMaxAge,
        path: "/",
      },
    }),
  );

  app.setGlobalPrefix("api/v1");

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.enableCors({
    origin: frontendUrl,
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "x-csrf-token", "x-xsrf-token", "X-CSRF-Token", "X-XSRF-Token"],
  });

  await app.listen(port);
  console.log(`RENKO API listening on http://localhost:${port}/api/v1 (env=${nodeEnv})`);
}

void bootstrap();
