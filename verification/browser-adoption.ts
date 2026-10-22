import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, relative } from "node:path";
import { encode as referenceEncode, ExtensionCodec as ReferenceExtensionCodec } from "msgpack-javascript-original";
import { installDependencies, runCommand } from "./command.ts";
import {
  fixtures,
  GeoPoint,
  installExtensionCodec,
  malformedCases,
} from "../examples/browser/src/fixtures.ts";

const referenceCodec = new ReferenceExtensionCodec();
installExtensionCodec(referenceCodec);

const root = dirname(import.meta.dirname);
const appDir = join(root, "examples/browser");
const packageDir = join(root, "packages/msgpack");
const appName = appDir.slice(appDir.lastIndexOf("/") + 1);
const copyDir = (variant: "baseline" | "replacement") =>
  join(root, ".tmp/adoption", `${appName}-${variant}`);
const sourceFiles = ["index.html", "src/main.ts", "src/fixtures.ts"];
const ORIGINAL_NAME = "@msgpack/msgpack";
const ORIGINAL_SPEC = "npm:@msgpack/msgpack@3.1.3";
const REPLACEMENT_NAME = "@dsdenes/msgpack";
const CHROME = process.env.CHROME_PATH ?? "google-chrome";

async function sourceHashes(): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const file of sourceFiles) {
    hashes[file] = createHash("sha256").update(await readFile(join(appDir, file))).digest("hex");
  }
  return hashes;
}

/**
 * Copies the application into a generated directory, rewrites the package
 * specifier in the baseline copy only, and installs the dependency for that
 * variant. The checked-in application is never modified.
 */
async function makeApp(variant: "baseline" | "replacement"): Promise<string> {
  const dir = copyDir(variant);
  await rm(dir, { recursive: true, force: true });
  await cp(appDir, dir, {
    recursive: true,
    filter: (source) => {
      const rel = relative(appDir, source);
      return rel === "" || (!rel.startsWith("node_modules") && !rel.startsWith("dist"));
    },
  });

  const manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  delete manifest.dependencies[ORIGINAL_NAME];
  delete manifest.dependencies[REPLACEMENT_NAME];
  if (variant === "baseline") {
    manifest.dependencies[ORIGINAL_NAME] = ORIGINAL_SPEC;
    let rewrites = 0;
    for (const file of sourceFiles) {
      const path = join(dir, file);
      const text = await readFile(path, "utf8");
      if (!text.includes(REPLACEMENT_NAME)) {
        continue;
      }
      rewrites += text.split(REPLACEMENT_NAME).length - 1;
      await writeFile(path, text.split(REPLACEMENT_NAME).join(ORIGINAL_NAME));
    }
    if (rewrites === 0) {
      throw new Error(`no source file imports ${REPLACEMENT_NAME}`);
    }
  } else {
    manifest.dependencies[REPLACEMENT_NAME] = `file:${relative(dir, packageDir)}`;
  }
  await writeFile(join(dir, "package.json"), JSON.stringify(manifest, null, 2) + "\n");

  installDependencies(dir, variant);
  return dir;
}

async function build(dir: string): Promise<void> {
  await rm(join(dir, "dist"), { recursive: true, force: true });
  const result = runCommand(
    [
      process.execPath,
      join(dir, "node_modules", "vite", "bin", "vite.js"),
      "build",
      "--outDir",
      "dist",
      "--emptyOutDir",
      // Comparing error names requires both bundles to preserve class names;
      // minification renames them differently in each dependency's bundle.
      "--minify",
      "false",
    ],
    dir,
  );
  if (result.exitCode !== 0) {
    throw new Error(`vite build failed: ${result.output}`);
  }
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

async function serve(directory: string): Promise<{ url: string; stop: () => void }> {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    try {
      const body = await readFile(join(directory, relative));
      response.writeHead(200, {
        "content-type": CONTENT_TYPES[extname(relative)] ?? "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("not found");
    }
  });
  await new Promise<void>((listening) => {
    server.listen(0, "127.0.0.1", listening);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("browser verification server has no port");
  }
  return {
    url: `http://127.0.0.1:${address.port}/`,
    stop: () => server.close(),
  };
}

async function runChrome(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      CHROME,
      args,
      {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, TMPDIR: ".tmp/tmp" },
        timeout: 30_000,
        maxBuffer: 32 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`chrome failed: ${String(stderr) || error.message}`));
          return;
        }
        resolve(String(stdout));
      },
    );
  });
}

async function loadInBrowser(url: string): Promise<unknown> {
  // Relative paths keep Chrome's Unix socket below the kernel's length limit.
  await mkdir(join(root, ".tmp", "chrome"), { recursive: true });
  await mkdir(join(root, ".tmp", "tmp"), { recursive: true });
  const dom = await runChrome([
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--user-data-dir=.tmp/chrome",
    "--virtual-time-budget=5000",
    "--dump-dom",
    url,
  ]);
  const match = dom.match(/<pre id="result">([\s\S]*?)<\/pre>/);
  if (!match) {
    throw new Error(`no result element in DOM: ${dom.slice(0, 500)}`);
  }
  const text = match[1]
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
  if (text === "running") {
    throw new Error("browser application did not finish");
  }
  return JSON.parse(text);
}

interface BrowserCase {
  name: string;
  hex: string;
  decoded: unknown;
  matchesInput: boolean;
}

interface BrowserStreaming {
  values: unknown[];
  empty: unknown[];
  truncated: unknown[];
  single: unknown;
  array: unknown[];
  classStream: unknown[];
}

interface BrowserFailure {
  name: string;
  message: string;
}

interface BrowserMalformedCase {
  name: string;
  decode: { ok: boolean; value?: unknown; error?: BrowserFailure };
  multi: { values: unknown[]; error?: BrowserFailure };
  array: { values: unknown[]; error?: BrowserFailure };
  single: { ok: boolean; value?: unknown; error?: BrowserFailure };
}

interface BrowserResult {
  moduleEncodeHex: string;
  sharedRefSame: boolean;
  classDecodeSame: boolean;
  cases: BrowserCase[];
  streaming: BrowserStreaming;
  malformed: BrowserMalformedCase[];
}

async function run(variant: "baseline" | "replacement"): Promise<BrowserResult> {
  const dir = await makeApp(variant);
  await build(dir);
  const server = await serve(join(dir, "dist"));
  try {
    return (await loadInBrowser(server.url)) as BrowserResult;
  } finally {
    server.stop();
  }
}

const hashesBefore = await sourceHashes();
const baseline = await run("baseline");
const replacement = await run("replacement");
const hashesAfter = await sourceHashes();
await rm(copyDir("baseline"), { recursive: true, force: true });
await rm(copyDir("replacement"), { recursive: true, force: true });

const sourcesUnchanged = JSON.stringify(hashesBefore) === JSON.stringify(hashesAfter);
const identical = JSON.stringify(baseline) === JSON.stringify(replacement);

const expected: Record<string, string> = {};
for (const [name, value] of fixtures) {
  expected[name] = Buffer.from(referenceEncode(value, { extensionCodec: referenceCodec })).toString("hex");
}
const hexMatchesReference = replacement.cases.every((item) => expected[item.name] === item.hex);
const allRoundTrip = replacement.cases.every((item) => item.matchesInput);
const classApi =
  replacement.sharedRefSame &&
  replacement.classDecodeSame &&
  replacement.moduleEncodeHex === expected["small map"] &&
  baseline.moduleEncodeHex === replacement.moduleEncodeHex;

function canonical(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date) {
    return { __date: value.getTime() };
  }
  if (value instanceof GeoPoint) {
    return { __point: [value.lat, value.lon] };
  }
  if (value instanceof Uint8Array) {
    return { __binary: Buffer.from(value).toString("hex") };
  }
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  const record: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    record[key] = canonical(item);
  }
  return record;
}

const streamedNames = [
  "small map",
  "small array",
  "binary",
  "timestamp epoch",
  "custom point",
  "extensions nested",
];
const streamedValues = streamedNames.map((name) => {
  const entry = fixtures.find(([fixtureName]) => fixtureName === name);
  if (entry === undefined) {
    throw new Error(`missing fixture: ${name}`);
  }
  return entry[1];
});
const expectedStream = canonical(streamedValues) as unknown[];
const streaming = replacement.streaming;
const streamingOk =
  JSON.stringify(streaming.values) === JSON.stringify(expectedStream) &&
  streaming.empty.length === 0 &&
  JSON.stringify(streaming.truncated) === JSON.stringify(expectedStream) &&
  JSON.stringify(streaming.single) === JSON.stringify(expectedStream[0]) &&
  JSON.stringify(streaming.array) === JSON.stringify(expectedStream[1]) &&
  JSON.stringify(streaming.classStream) === JSON.stringify(expectedStream);

const malformed = replacement.malformed;
const expectedMalformedNames = [
  ...malformedCases.map(([name]) => name),
  "valid messages then a truncated tail",
];
const malformedShapeOk =
  malformed.length === expectedMalformedNames.length &&
  expectedMalformedNames.every((name, index) => malformed[index]?.name === name) &&
  malformed.every((item) =>
    typeof item.decode.ok === "boolean" &&
    (item.decode.ok
      ? item.decode.value !== undefined && item.decode.error === undefined
      : typeof item.decode.error?.name === "string" && item.decode.error.message.length > 0) &&
    Array.isArray(item.multi.values) &&
    (item.multi.error === undefined ||
      (typeof item.multi.error.name === "string" && item.multi.error.message.length > 0)) &&
    Array.isArray(item.array.values) &&
    (item.array.error === undefined ||
      (typeof item.array.error.name === "string" && item.array.error.message.length > 0)) &&
    typeof item.single.ok === "boolean" &&
    (item.single.ok ||
      (typeof item.single.error?.name === "string" && item.single.error.message.length > 0))
  );
const malformedOk =
  malformedShapeOk &&
  malformed.some((item) => !item.decode.ok) &&
  malformed.some((item) => item.decode.ok);

const report = {
  sourcesUnchanged,
  sourceHashes: hashesAfter,
  identical,
  malformedOk,
  hexMatchesReference,
  allRoundTrip,
  classApi,
  streamingOk,
  malformedCases: malformed.length,
  streamedMessages: streaming.values.length,
  cases: replacement.cases.map((item) => item.name),
  baselineModuleEncodeHex: baseline.moduleEncodeHex,
  replacementModuleEncodeHex: replacement.moduleEncodeHex,
};

console.log(JSON.stringify(report, null, 2));

if (
  !sourcesUnchanged ||
  !identical ||
  !hexMatchesReference ||
  !allRoundTrip ||
  !classApi ||
  !streamingOk ||
  !malformedOk
) {
  process.exitCode = 1;
}
