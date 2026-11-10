import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";

export const mockProductImageHttpResponse = (
  callback: (response: IncomingMessage) => void,
  input: { body?: string | Uint8Array | Uint8Array[]; status?: number; headers?: Record<string, string> } = {},
) => {
  const request = new EventEmitter() as EventEmitter & { end: () => void };
  request.end = () => {
    const body = input.body ?? new Uint8Array([0xff, 0xd8, 0xff]);
    const response = Object.assign(
      Readable.from(Array.isArray(body) ? body : [typeof body === "string" ? Buffer.from(body) : body]),
      { statusCode: input.status ?? 200, headers: input.headers ?? { "content-type": "image/jpeg" } },
    ) as IncomingMessage;
    callback(response);
  };
  return request;
};
