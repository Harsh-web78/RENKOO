import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";

/**
 * PROMPT 7 (P1) — global exception sanitizer.
 *
 * Guarantees the API error contract: HttpExceptions (typed `{code,message}`
 * + status, thrown by controllers/services) pass through untouched, while any
 * unexpected throw (Prisma errors, driver messages, raw objects) is collapsed
 * to a generic 500 `{code:"UNKNOWN_ERROR"}` WITHOUT leaking internals
 * (connection strings, SQL, stack traces) to the client. Detail is logged
 * server-side for operators.
 */
@Catch()
export class SanitizeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SanitizeExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    if (exception instanceof HttpException) {
      // Typed API error contract — serialize exactly as Nest's default
      // handler would (status + getResponse() body). Never rethrow: a throw
      // from inside a @Catch() filter escapes Nest handling and Express
      // renders an HTML stack-trace page instead.
      const status = exception.getStatus();
      const body = exception.getResponse();
      response.status(status).json(typeof body === "object" && body !== null ? body : { code: "UNKNOWN_ERROR", message: String(body) });
      return;
    }

    // Log path WITHOUT the query string: callback URLs carry the OAuth
    // authorization `code` and `state` as query params, and the code is
    // exchangeable for tokens — it must never land in server logs.
    const rawUrl = typeof request?.url === "string" ? request.url : "?";
    const safeUrl = rawUrl.split("?")[0] as string;
    this.logger.error(
      `Unhandled ${request?.method ?? "?"} ${safeUrl}: ${
        exception instanceof Error ? `${exception.name}: ${exception.message}` : String(exception)
      }`,
    );

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: "UNKNOWN_ERROR",
      message: "An unexpected error occurred.",
    });
  }
}
