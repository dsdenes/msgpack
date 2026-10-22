import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";

/**
 * Shared process helpers for the adoption checks. Installs and caches stay
 * inside the repository: npm writes its cache and logs below the root, never
 * to a home directory or a system temporary directory.
 */

export const repositoryRoot = dirname(import.meta.dirname);

const npmEnvironment = {
  npm_config_cache: join(repositoryRoot, ".npm-cache"),
  npm_config_logs_dir: join(repositoryRoot, ".npm-logs"),
  npm_config_update_notifier: "false",
};

export interface CommandResult {
  exitCode: number;
  output: string;
}

/** Installs one generated application's dependencies with npm. */
export function installDependencies(cwd: string, label: string): void {
  const result = spawnSync(
    "npm",
    ["install", "--no-audit", "--no-fund", "--no-progress", "--silent"],
    { cwd, encoding: "utf8", env: { ...process.env, ...npmEnvironment } },
  );
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    throw new Error(`npm install failed for ${label}: ${detail}`);
  }
}

/** Runs a command from the generated application's directory. */
export function runCommand(
  command: string[],
  cwd: string,
  environment: Record<string, string> = {},
): CommandResult {
  const result = spawnSync(command[0], command.slice(1), {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...environment },
    timeout: 120_000,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return {
    exitCode: result.status ?? -1,
    output: `${stdout}${stderr}`.trim(),
  };
}
