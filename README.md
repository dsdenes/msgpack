# @dsdenes/msgpack

A byte-compatible, drop-in replacement for
[msgpack-javascript 3.1.3](https://github.com/msgpack/msgpack-javascript)
covering everyday payloads: nulls, booleans, numbers, strings, binary data,
arrays, maps, timestamps, application-registered extension types, and nested
combinations of them. It is published as `@dsdenes/msgpack@1.0.0`; applications
install it directly and import the same API names.

## Runtime support

The repository and the published package target Node.js 24 LTS (Krypton).
`package.json` pins `engines.node` to `24.x`, `.nvmrc` holds `24`, and install,
build, type checking, tests, the benchmark, and every verification script run
with `npm` and `node`. The package itself declares no `engines` field and no
runtime dependencies, so browser and other non-Node consumers stay unblocked,
and the UMD bundle described below keeps browser support.

## Benchmark

`@dsdenes/msgpack` is a drop-in replacement for msgpack-javascript 3.1.3: same
API, same bytes on the wire, and the same decoded values. It is also faster.

Median percentages across the 33 measured payloads, comparing the replacement
against the original on the same machine and payloads:

| Operation | Median time (new ÷ original) | Median speedup | Best case | Worst case |
|---|---:|---:|---:|---:|
| Encode | 48% | 2.08× | 89% less time | 3.8% less time |
| Decode | 38% | 2.65× | 84% less time | 2.3% less time |

Every measured payload encodes and decodes faster; none is slower for either
operation. A typical application response encodes about 1.4× and decodes about
1.35× faster; long ASCII text encodes about 3.6× faster. Measured on Node.js
24.18.0, Linux x64 (AMD Ryzen 9 5950X), one call at a time in alternating
order, after warmup. The cases range from one-byte primitives through 256 KB
binary values, 20,000-element arrays, 4,000-key maps, and 220 KB nested
responses.

## Install

Install the package and replace the import specifier:

```sh
npm install @dsdenes/msgpack
```

```ts
import { decode, encode } from "@dsdenes/msgpack";

const bytes = encode({ id: 1, name: "widget" });
const value = decode(bytes);
```

The package root also has a default export that holds the same API, so code
that used a single namespace object can keep that shape:

```ts
import msgpack from "@dsdenes/msgpack";

const bytes = msgpack.encode({ id: 1, name: "widget" });
```

No dependency alias and no `file:` dependency is needed. The package exposes
conditional ESM and CommonJS entry points, so `import ... from
"@dsdenes/msgpack"`, `require("@dsdenes/msgpack")`, and the CommonJS `.default`
property all resolve to this implementation.

Build tooling that resolves dependencies the traditional way — classic Node
module resolution, or a bundler that reads `main`/`module` and never looks at
conditional `exports` — finds the same implementation through the package's
top-level `main`, `module`, and `types` fields. A strict TypeScript application
using `moduleResolution: "node"` and a Browserify bundle both build from an
unchanged source and configuration after the import replacement.

The package ships its declarations, README, and ISC LICENSE, and exposes these
subpaths: `@dsdenes/msgpack/package.json`, `@dsdenes/msgpack/lib/index.mjs`,
`@dsdenes/msgpack/lib/index.cjs`, `@dsdenes/msgpack/lib/index.d.ts`, and
`@dsdenes/msgpack/lib/msgpack.js`. Reference-internal paths (`dist.esm/*`,
`dist.cjs/*`, `src/*`) are out of scope and have no shims.

A page that loads msgpack-javascript with one plain script reference, without a
bundler or a build step, points that reference at the package's UMD bundle and
keeps its markup and inline script unchanged:

```html
<script src="https://unpkg.com/@dsdenes/msgpack/lib/msgpack.js"></script>
```

The bundle defines the same `MessagePack` global as msgpack-javascript's UMD
build, including `encode`, `decode`, the `Encoder`/`Decoder` classes, the
timestamp helpers, and the extension codec. `packages/msgpack/lib/msgpack.js`
is built from the same source as the module entry points and is what the
package's `unpkg` and `cdn` fields resolve to; adopting a plain-script page
changes only the one `src`.

## API

- `encode(value, options?)` returns the MessagePack encoding as a `Uint8Array`.
- `decode(buffer, options?)` accepts a `Uint8Array`, another `ArrayBufferView`,
  an `ArrayBuffer`, or an array-like of bytes, and decodes exactly one message.
- `decodeMulti(buffer, options?)` accepts the same input forms and returns a
  generator that yields every consecutive message in the buffer, in order.
- `decodeMultiStream(streamLike, options?)` and `decodeArrayStream(streamLike,
  options?)` return async generators that decode messages, or the items of one
  array, from an async iterable of chunks or a WHATWG `ReadableStream`;
  `decodeAsync(streamLike, options?)` decodes exactly one message from a stream.
- `new Encoder(options?)` with `encode` and `encodeSharedRef`.
- `new Decoder(options?)` with `decode`, `decodeMulti`, `decodeStream`,
  `decodeArrayStream`, and `decodeAsync`.
- `new ExtensionCodec()` with `register`, `tryToEncode`, and `decode`, plus
  `ExtensionCodec.defaultCodec` and `ExtData`.
- `DecodeError`, the error class raised by decoder length limits and the
  default map key converter.
- Timestamp helpers: `EXT_TIMESTAMP`, `encodeDateToTimeSpec`,
  `encodeTimeSpecToTimestamp`, `decodeTimestampToTimeSpec`,
  `encodeTimestampExtension`, and `decodeTimestampExtension`.
- `Encoder` and `Decoder` accept every option listed below; the module-level
  `encode`, `decode`, `decodeMulti`, and stream decoders accept the same options.

Default behaviour matches msgpack-javascript 3.1.3: smallest integer widths,
float64 for non-integers, UTF-8 strings with the same fixstr/str8/str16/str32
thresholds, the same bin/array/map widths, plain-object maps with string or
number keys, `Uint8Array` binary values, and the built-in timestamp extension.

## TypeScript

The published declarations reproduce the types msgpack-javascript 3.1.3
publishes, including its generics and type names. A typed consumer swaps the
dependency without touching its source:

```ts
import {
  Encoder,
  ExtensionCodec,
  encode,
  type DecoderOptions,
  type EncoderOptions,
  type ExtensionCodecType,
  type ExtensionDecoderType,
  type ExtensionEncoderType,
} from "@dsdenes/msgpack";

interface AppContext {
  requestId: string;
}

const codec = new ExtensionCodec<AppContext>();
codec.register({ type: 42, encode, decode });

const encoderOptions: EncoderOptions<AppContext> = {
  extensionCodec: codec,
  context: { requestId: "req-1" },
};
const encoder = new Encoder<AppContext>(encoderOptions);
const bytes = encode<AppContext>(value, encoderOptions);
```

`EncoderOptions<ContextType>`, `DecoderOptions<ContextType>`,
`Encoder<ContextType>`, `Decoder<ContextType>`, and
`ExtensionCodec<ContextType>` carry the same context generic as the original.
`ExtensionCodecType`, `ExtensionEncoderType`, and `ExtensionDecoderType` name
the codec contract, and `ContextOf`/`SplitUndefined` describe how a context
became required. Defaults and inference match the original, so untyped
consumers and consumers that never mention a context compile unchanged too.

## Multiple messages

`decodeMulti` reads a buffer that holds several consecutive MessagePack values,
the same way msgpack-javascript does:

```ts
import { decodeMulti, encode } from "@dsdenes/msgpack";

const buffer = new Uint8Array([...encode("first"), ...encode({ second: 2 })]);
for (const message of decodeMulti(buffer)) {
  console.log(message);
}
```

The module function and `new Decoder(options).decodeMulti(buffer)` yield the
same values in the same order and accept the same decoding options. An empty
buffer yields no messages. If the final message is incomplete, every complete
message before it is yielded and the iteration then throws `RangeError`, as in
the reference. `decode` keeps decoding exactly one message and rejects a buffer
that holds more.

## Streams

The incremental, stream-fed decoding surface matches msgpack-javascript:
`decodeMultiStream(streamLike, options?)` and
`new Decoder(options).decodeStream(stream)` consume an async iterable of byte
chunks or a WHATWG `ReadableStream` and yield each complete message as soon as
its last byte arrives, in order. Chunk boundaries may fall anywhere inside a
message.

```ts
import { decodeMultiStream, encode } from "@dsdenes/msgpack";

const stream = new ReadableStream<Uint8Array>({
  start(controller) {
    controller.enqueue(new Uint8Array([...encode("first"), ...encode({ second: 2 })]));
    controller.close();
  },
});

for await (const message of decodeMultiStream(stream)) {
  console.log(message);
}
```

An empty stream yields no messages and does not fail. A stream that ends
partway through a message delivers every complete message before it and then
ends, exactly as the reference does; `decodeAsync(streamLike, options?)` is the
single-message form and throws the reference's `RangeError` for an empty or
incomplete stream. `decodeArrayStream(streamLike, options?)` and
`Decoder.decodeArrayStream` yield the items of one streaming array. All stream
functions accept the same decoding options as `decode`, and the module functions
also accept a WHATWG `ReadableStream` in runtimes where it is not an async
iterable.

## Extensions

`Date` values encode through the built-in timestamp extension exactly as the
reference does. Application types register on an `ExtensionCodec`, and the
codec is passed to both libraries:

```ts
const codec = new ExtensionCodec();
codec.register({ type: 42, encode, decode });

const bytes = encode(value, { extensionCodec: codec });
const decoded = decode(bytes, { extensionCodec: codec });
```

Custom types nested in arrays and maps use the same codec, unknown extension
types decode to `ExtData`, and `ExtData` values re-encode unchanged.

## Options

Options match msgpack-javascript 3.1.3. Every documented option can be passed
to the module functions and to `Encoder`/`Decoder`.

Encoding options:

| Name                  | Type             | Default                       |
| --------------------- | ---------------- | ----------------------------- |
| `extensionCodec`      | `ExtensionCodec` | `ExtensionCodec.defaultCodec` |
| `context`             | user-defined     | -                             |
| `useBigInt64`         | `boolean`        | `false`                       |
| `maxDepth`            | `number`         | `100`                         |
| `initialBufferSize`   | `number`         | `2048`                        |
| `sortKeys`            | `boolean`        | `false`                       |
| `forceFloat32`        | `boolean`        | `false`                       |
| `forceIntegerToFloat` | `boolean`        | `false`                       |
| `ignoreUndefined`     | `boolean`        | `false`                       |

Decoding options:

| Name              | Type                 | Default                                      |
| ----------------- | -------------------- | -------------------------------------------- |
| `extensionCodec`  | `ExtensionCodec`     | `ExtensionCodec.defaultCodec`                |
| `context`         | user-defined         | -                                            |
| `useBigInt64`     | `boolean`            | `false`                                      |
| `rawStrings`      | `boolean`            | `false`                                      |
| `maxStrLength`    | `number`             | `4_294_967_295` (`UINT32_MAX`)               |
| `maxBinLength`    | `number`             | `4_294_967_295` (`UINT32_MAX`)               |
| `maxArrayLength`  | `number`             | `4_294_967_295` (`UINT32_MAX`)               |
| `maxMapLength`    | `number`             | `4_294_967_295` (`UINT32_MAX`)               |
| `maxExtLength`    | `number`             | `4_294_967_295` (`UINT32_MAX`)               |
| `keyDecoder`      | `KeyDecoder \| null` | shared bounded cache                         |
| `mapKeyConverter` | `(key) => string \| number` | throws `DecodeError` for other key types |

`useBigInt64` encodes `bigint` values as int64/uint64 and decodes those formats
as `bigint`; numbers that do not fit a 32-bit integer width become floats in
this mode, as in the reference. `rawStrings` returns `Uint8Array` for string
values while map keys stay strings, and its values are limited by
`maxBinLength`. The `max*Length` options reject input with `DecodeError` at the
same boundary as the reference. `keyDecoder: null` disables the shared key
cache.

## Development

Install and run everything from the repository root with Node.js 24 LTS on
`PATH`:

| Command | Purpose |
| --- | --- |
| `npm ci` | Install the workspace from `package-lock.json` |
| `npm run build` | Write the ESM, CommonJS, declaration, and UMD files under `packages/msgpack/lib/` |
| `npm run typecheck` | Type-check the workspace with `tsc` |
| `npm test` | Build, then run the differential tests against msgpack-javascript 3.1.3 |
| `npm run bench` | Build, then compare encode and decode timings for all 33 cases |
| `npm run verify:options` | Public entry points: encoding and decoding options |
| `npm run verify:multi` | Public entry points: consecutive-message decoding |
| `npm run verify:stream` | Public entry points: stream-fed decoding |
| `npm run verify:malformed` | Malformed and unusual input across every entry point |
| `npm run verify:surface` | Exports, subpaths, declarations, and tarball contents |
| `npm run verify:typed` | Adopting application with strict TypeScript types |
| `npm run verify:classic-typed` | Adopting application with classic Node resolution |
| `npm run verify:classic-bundler` | Adopting application bundled by Browserify |
| `npm run verify:server` | Node server application before and after the swap |
| `npm run verify:browser` | Browser application before and after the swap (needs `google-chrome`) |
| `npm run verify:browser-script` | Plain-script page before and after the swap (needs `google-chrome`) |
| `npm run verify:adoption` | All six adoption applications |

The verification scripts keep generated applications, npm installations, and
browser profiles under `.tmp/`, and npm's cache and logs under `.npm-cache/`
and `.npm-logs/`.
