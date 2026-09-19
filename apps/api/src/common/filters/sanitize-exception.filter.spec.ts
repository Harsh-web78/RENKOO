import { HttpException, HttpStatus } from "@nestjs/common";
import { SanitizeExceptionFilter } from "./sanitize-exception.filter";

/**
 * Prompt 7 (P1): the global exception filter must pass typed HttpExceptions
 * through untouched and collapse everything else (Prisma errors, raw throws)
 * to a generic 500 with no internals leaked.
 */
describe("SanitizeExceptionFilter", () => {
  const filter = new SanitizeExceptionFilter();

  function mockHost() {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    return {
      host: { switchToHttp: () => ({ getResponse: () => ({ status }), getRequest: () => ({ method: "GET", url: "/x" }) }) } as any,
      status,
      json,
    };
  }

  it("passes typed HttpExceptions through with status + body (no HTML, no stack)", () => {
    const { host, status, json } = mockHost();
    const err = new HttpException({ code: "PROPERTY_NOT_FOUND", message: "nope" }, HttpStatus.NOT_FOUND);
    filter.catch(err, host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({ code: "PROPERTY_NOT_FOUND", message: "nope" });
  });

  it("collapses Prisma-style errors to generic 500 without leaking detail", () => {
    const { host, status, json } = mockHost();
    const prismaLike = new Error(
      "Authentication failed against database server at `localhost`, the provided database credentials for `renko` are not valid.",
    );
    prismaLike.name = "PrismaClientInitializationError";
    filter.catch(prismaLike, host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ code: "UNKNOWN_ERROR", message: "An unexpected error occurred." });
    expect(JSON.stringify(json.mock.calls[0][0])).not.toMatch(/localhost|renko|credential/i);
  });

  it("collapses raw object throws to generic 500", () => {
    const { host, status, json } = mockHost();
    filter.catch({ code: "SECRET_INTERNALS", conn: "postgresql://x" } as any, host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({ code: "UNKNOWN_ERROR", message: "An unexpected error occurred." });
  });
});
