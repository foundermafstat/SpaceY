import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { captureException } from "@spacey/observability";
import { ZodError } from "zod";
import { ApiError } from "./api-error.js";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();
    const correlationId = request.id;

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: "validation_failed",
          message: "Request validation failed.",
          correlationId,
          details: { issues: error.issues }
        }
      });
    }

    if (error instanceof ApiError) {
      return reply.status(error.status).send({
        error: {
          code: error.code,
          message: error.message,
          correlationId,
          ...(error.details ? { details: error.details } : {})
        }
      });
    }

    if (error instanceof HttpException) {
      const response = error.getResponse();
      return reply.status(error.getStatus()).send({
        error: {
          code: "http_error",
          message: typeof response === "string" ? response : error.message,
          correlationId
        }
      });
    }

    request.log.error({ err: error, correlationId }, "Unhandled API error");
    captureException(error, { service: "api", correlationId, method: request.method, route: request.routeOptions.url });
    return reply.status(500).send({
      error: {
        code: "internal_error",
        message: "Internal server error.",
        correlationId
      }
    });
  }
}
