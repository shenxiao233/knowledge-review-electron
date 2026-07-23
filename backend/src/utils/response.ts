import type { FastifyReply } from 'fastify';

export function fail(reply: FastifyReply, statusCode: number, message: string) {
  return reply.code(statusCode).send({ error: message });
}

export function success(reply: FastifyReply, data: any, statusCode = 200) {
  return reply.code(statusCode).send(data);
}
