import path from "node:path";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
export const repoRoot = path.resolve(path.dirname(thisFile), "..");

export function fixturePath(name: string): string {
  return path.join(repoRoot, "fixtures", name);
}
