import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const dir = await mkdtemp(join(tmpdir(), "ludo-api-tests-"));
try {
  const outfile = join(dir, "routes.mjs");
  await build({
    entryPoints: [process.argv[2] ?? "tests/routes.test.ts"], outfile, bundle: true, platform: "node", format: "esm",
    external: ["pg-native", "bufferutil", "utf-8-validate"],
    banner: { js: "import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);" },
    define: { "process.env.NODE_ENV": '"production"', "process.env.LOG_LEVEL": '"silent"' },
  });
  const code = await new Promise(resolve => {
    const child = spawn(process.execPath, [outfile], { stdio: "inherit" });
    child.on("exit", resolve);
  });
  process.exitCode = typeof code === "number" ? code : 1;
} finally { await rm(dir, { recursive: true, force: true }); }
