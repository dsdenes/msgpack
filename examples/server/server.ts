import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Decoder, Encoder, ExtensionCodec, decode, decodeMultiStream, encode } from "@dsdenes/msgpack";
import { fixtures, GeoPoint, installExtensionCodec } from "./fixtures.ts";

// A small application that already depended on msgpack-javascript. Its source
// is not edited when the dependency is swapped for the replacement.
const extensionCodec = new ExtensionCodec();
installExtensionCodec(extensionCodec);

const decoder = new Decoder({ extensionCodec });
const encoder = new Encoder({ extensionCodec });

const server = createServer((request, response) => {
  handle(request, response).catch((error: unknown) => {
    sendText(response, String(error), 500);
  });
});

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (url.pathname === "/health") {
    sendText(response, "ok");
    return;
  }

  if (url.pathname === "/fixtures") {
    sendBytes(response, encode(fixtures, { extensionCodec }));
    return;
  }

  if (url.pathname === "/decode" && request.method === "POST") {
    const body = await readBody(request);
    try {
      const value = decoder.decode(body);
      sendJson(response, { ok: true, kind: typeOf(value), value: describeValue(value) });
    } catch (error) {
      sendJson(response, { ok: false, error: describeError(error) });
    }
    return;
  }

  if (url.pathname === "/multi" && request.method === "POST") {
    const body = await readBody(request);
    const values: unknown[] = [];
    try {
      for (const value of decoder.decodeMulti(body)) {
        values.push(describeValue(value));
      }
      sendJson(response, { values });
    } catch (error) {
      sendJson(response, { values, error: describeError(error) });
    }
    return;
  }

  if (url.pathname === "/encode" && request.method === "POST") {
    const payload = JSON.parse(await readText(request));
    sendBytes(response, encoder.encode(payload));
    return;
  }

  if (url.pathname === "/stream" && request.method === "POST") {
    // The request body is a byte stream holding consecutive messages. The
    // application consumes it incrementally, with boundaries inside messages.
    const body = await readBody(request);
    const values: unknown[] = [];
    try {
      for await (const value of decodeMultiStream(chunked(body, 3), { extensionCodec })) {
        values.push(describeValue(value));
      }
      sendJson(response, { values });
    } catch (error) {
      sendJson(response, { values, error: describeError(error) });
    }
    return;
  }

  if (url.pathname === "/roundtrip" && request.method === "POST") {
    const body = await readBody(request);
    const value = decode(body, { extensionCodec });
    sendBytes(response, encode(value, { extensionCodec }));
    return;
  }

  sendText(response, "not found", 404);
}

async function readBody(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

async function readText(request: IncomingMessage): Promise<string> {
  return new TextDecoder().decode(await readBody(request));
}

function sendText(response: ServerResponse, text: string, status = 200): void {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(text);
}

function sendJson(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function sendBytes(response: ServerResponse, bytes: Uint8Array): void {
  response.writeHead(200, { "content-type": "application/msgpack" });
  response.end(bytes);
}

function describeError(error: unknown): { name: string; message: string } {
  const typed = error as Error;
  return { name: typed.name, message: String(typed.message) };
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (value instanceof Date) return "date";
  if (value instanceof GeoPoint) return "point";
  if (typeof value === "object") return "map";
  return typeof value;
}

async function* chunked(bytes: Uint8Array, size: number): AsyncIterable<Uint8Array> {
  for (let offset = 0; offset < bytes.length; offset += size) {
    yield bytes.subarray(offset, Math.min(offset + size, bytes.length));
  }
}

function describeValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date) {
    return { date: value.getTime() };
  }
  if (value instanceof GeoPoint) {
    return { point: [value.lat, value.lon] };
  }
  if (value instanceof Uint8Array) {
    let encoded = "";
    for (const byte of value) {
      encoded += byte.toString(16).padStart(2, "0");
    }
    return { binary: encoded };
  }
  if (Array.isArray(value)) {
    return value.map(describeValue);
  }
  const record: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    record[key] = describeValue(item);
  }
  return record;
}

server.listen(Number(process.env.PORT ?? 0), "127.0.0.1", () => {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("server did not bind a TCP port");
  }
  console.log(`PORT=${address.port}`);
});
