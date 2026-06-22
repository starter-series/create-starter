import { chmodSync, existsSync } from "node:fs";
import { join } from "node:path";

const binPath = join(process.cwd(), "dist", "index.js");

if (!existsSync(binPath)) {
  throw new Error(`missing built bin: ${binPath}`);
}

chmodSync(binPath, 0o755);
