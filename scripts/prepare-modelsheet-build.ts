// Stage only the reviewed node, runner and guide. No character files or credentials travel.
import { copyFile, cp, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const source = join(process.cwd(), "integrations/modelsheetto3d");
const target = resolve(process.argv[2] ?? ".test-output/modelsheet-comfy");
const node = join(target, "custom_nodes/character_forge_modelsheet");
await mkdir(node, { recursive: true });
await cp(join(source, "custom_nodes/character_forge_modelsheet"), node, { recursive: true, filter: (path) => !path.includes("__pycache__") });
for (const name of ["run.py", "README.md"]) await copyFile(join(source, name), join(node, name));
// Preserve the remote Build identity when re-staging an existing build.
try { await readFile(join(target, "comfy-build.yaml")); }
catch { await copyFile(join(source, "comfy-build.yaml"), join(target, "comfy-build.yaml")); }
await mkdir(join(target, "models"), { recursive: true });
console.log(target);
