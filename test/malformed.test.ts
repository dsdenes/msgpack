import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  decode as referenceDecode,
  decodeMulti as referenceDecodeMulti,
  decodeMultiStream as referenceDecodeMultiStream,
  encode as referenceEncode,
} from "msgpack-javascript-original";
import {
  DecodeError,
  decode,
  decodeMulti,
  decodeMultiStream,
} from "@dsdenes/msgpack";

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function outcome(run: () => unknown): string {
  try {
    return "value:" + JSON.stringify(run());
  } catch (error) {
    const typed = error as Error;
    return `error:${typed.constructor.name}:${typed.name}:${typed.message}`;
  }
}

async function streamValues(
  stream: AsyncIterable<Uint8Array>,
  collect: (source: AsyncIterable<Uint8Array>) => AsyncGenerator<unknown>,
): Promise<{ values: unknown[]; error?: { constructor: string; name: string; message: string } }> {
  const values: unknown[] = [];
  try {
    for await (const value of collect(stream)) {
      values.push(value);
    }
    return { values };
  } catch (error) {
    const typed = error as Error;
    return {
      values,
      error: { constructor: typed.constructor.name, name: typed.name, message: typed.message },
    };
  }
}

function chunksOf(bytes: Uint8Array, cuts: number[]): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  let previous = 0;
  for (const cut of cuts) {
    if (cut > previous) {
      chunks.push(bytes.slice(previous, cut));
      previous = cut;
    }
  }
  chunks.push(bytes.slice(previous));
  return chunks;
}

function iterable(chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  return (async function* () {
    for (const chunk of chunks) {
      yield chunk;
    }
  })();
}

describe("differences that malformed input exposes", () => {
  test("extra bytes report the reference's RangeError description", () => {
    const bytes = Uint8Array.from([0x01, 0x02, 0x03]);
    assert.strictEqual(
      outcome(() => decode(bytes)),
      "error:RangeError:RangeError:Extra 2 of 3 byte(s) found at buffer[1]",
    );
    assert.strictEqual(outcome(() => referenceDecode(bytes)), outcome(() => decode(bytes)));
  });

  test("the reserved type byte fails with DecodeError", () => {
    const bytes = Uint8Array.from([0xc1]);
    let error: unknown;
    try {
      decode(bytes);
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof DecodeError);
    assert.strictEqual((error as Error).name, "DecodeError");
    assert.strictEqual((error as Error).message, "Unrecognized type byte: 0xc1");
    assert.strictEqual(outcome(() => decode(bytes)), outcome(() => referenceDecode(bytes)));
  });

  test("a __proto__ map key fails with DecodeError", () => {
    const bytes = Uint8Array.from([
      0x81, 0xa9, ...new TextEncoder().encode("__proto__"), 0x01,
    ]);
    let error: unknown;
    try {
      decode(bytes);
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof DecodeError);
    assert.strictEqual((error as Error).message, "The key __proto__ is not allowed");
    assert.strictEqual(outcome(() => decode(bytes)), outcome(() => referenceDecode(bytes)));
  });

  test("a timestamp extension of the wrong size fails with DecodeError", () => {
    for (const bytes of [
      Uint8Array.from([0xd4, 0xff, 0x00]),
      Uint8Array.from([0xd5, 0xff, 0x00, 0x01]),
      Uint8Array.from([0xd8, 0xff, ...new Array(16).fill(0)]),
    ]) {
      assert.strictEqual(outcome(() => decode(bytes)), outcome(() => referenceDecode(bytes)));
      assert.ok(outcome(() => decode(bytes)).includes("error:DecodeError:DecodeError:"));
    }
  });

  test("every single-byte header fails or decodes exactly as the reference", () => {
    for (let header = 0; header < 256; header++) {
      for (const bytes of [
        Uint8Array.from([header]),
        Uint8Array.from([header, 0x00]),
        Uint8Array.from([header, 0x00, 0x00]),
        Uint8Array.from([header, 0xff, 0xff, 0xff, 0xff]),
      ]) {
        assert.deepStrictEqual(
          { hex: hex(bytes), decode: outcome(() => decode(bytes)) },
          {
            hex: hex(bytes),
            decode: outcome(() => referenceDecode(bytes)),
          },
        );
        assert.deepStrictEqual(
          { hex: hex(bytes), multi: outcome(() => [...decodeMulti(bytes)]) },
          {
            hex: hex(bytes),
            multi: outcome(() => [...referenceDecodeMulti(bytes)]),
          },
        );
      }
    }
  });

  test("every truncation of a payload matches the reference", () => {
    const payloads = [
      referenceEncode({ nested: [1, "two", new Uint8Array([3, 4])] }),
      referenceEncode(new Date(1700000000123)),
      referenceEncode("x".repeat(300)),
      referenceEncode(Array.from({ length: 20 }, (_, index) => index)),
    ];
    for (const payload of payloads) {
      for (let length = 0; length <= payload.length; length++) {
        const bytes = payload.slice(0, length);
        assert.deepStrictEqual(
          {
            hex: hex(bytes),
            decode: outcome(() => decode(bytes)),
            multi: outcome(() => [...decodeMulti(bytes)]),
          },
          {
            hex: hex(bytes),
            decode: outcome(() => referenceDecode(bytes)),
            multi: outcome(() => [...referenceDecodeMulti(bytes)]),
          },
        );
      }
    }
  });
});

describe("unusual but valid input", () => {
  test("deeply nested arrays decode without exhausting the call stack", () => {
    const depth = 30_000;
    const bytes = new Uint8Array(depth + 1);
    bytes.fill(0x91, 0, depth);
    bytes[depth] = 1;
    let value: unknown = decode(bytes);
    let actualDepth = 0;
    while (Array.isArray(value) && value.length === 1) {
      value = value[0];
      actualDepth++;
    }
    assert.strictEqual(actualDepth, depth);
    assert.strictEqual(value, 1);
    assert.strictEqual(outcome(() => referenceDecode(bytes)), outcome(() => decode(bytes)));
  });

  test("deeply nested maps decode without exhausting the call stack", () => {
    const depth = 30_000;
    const bytes = new Uint8Array(depth * 3 + 1);
    for (let index = 0; index < depth; index++) {
      bytes[index * 3] = 0x81;
      bytes[index * 3 + 1] = 0xa1;
      bytes[index * 3 + 2] = 0x61;
    }
    bytes[depth * 3] = 1;
    let value = decode(bytes) as Record<string, unknown>;
    let actualDepth = 0;
    while (typeof value === "object" && value !== null && Object.keys(value).length === 1) {
      const next = value.a;
      if (typeof next !== "object" || next === null) {
        break;
      }
      value = next as Record<string, unknown>;
      actualDepth++;
    }
    assert.strictEqual(actualDepth, depth - 1);
    assert.deepStrictEqual(value, { a: 1 });
  });

  test("invalid UTF-8 at a string tail matches the reference for every chunk split", async () => {
    // The reference reads continuation bytes past the string payload from its
    // current buffer, so the decoded value depends on where the chunk ends.
    const bytes = Uint8Array.from([
      0x93, 0xa4, 0x73, 0x34, 0x33, 0xe9, 0xd2, 0xff, 0xf8, 0x69, 0x3a, 0x90,
    ]);
    for (let cut = 0; cut <= bytes.length; cut++) {
      const chunks = chunksOf(bytes, [cut]);
      const expected = await streamValues(iterable(chunks), referenceDecodeMultiStream);
      const actual = await streamValues(iterable(chunks), decodeMultiStream);
      assert.deepStrictEqual(actual, expected);
    }
  });

  test("streamed messages that end partway through keep the reference error", async () => {
    const first = referenceEncode({ id: 1 });
    const second = referenceEncode("truncated");
    for (let length = 1; length <= second.length; length++) {
      const bytes = Uint8Array.from([...first, ...second.slice(0, length)]);
      for (let cut = 0; cut <= bytes.length; cut++) {
        const chunks = chunksOf(bytes, [cut]);
        assert.deepStrictEqual(
          await streamValues(iterable(chunks), decodeMultiStream),
          await streamValues(iterable(chunks), referenceDecodeMultiStream),
        );
      }
    }
  });
});
