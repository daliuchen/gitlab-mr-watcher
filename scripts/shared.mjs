import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const paths = {
  root,
  build: join(root, "build"),
  dist: join(root, "dist")
};

export const packageFiles = [
  "manifest.json",
  "README.md",
  "src",
  "icons"
];

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writeJson(path, data) {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function prepareDir(path) {
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
}

export async function copyPackageFiles(targetDir) {
  await mkdir(targetDir, { recursive: true });
  await Promise.all(packageFiles.map((file) =>
    cp(join(paths.root, file), join(targetDir, file), { recursive: true })
  ));
}

export async function zipDirectory(sourceDir, outputFile) {
  await mkdir(dirname(outputFile), { recursive: true });
  await rm(outputFile, { force: true });
  await execFileAsync("zip", ["-r", outputFile, "."], { cwd: sourceDir });
}
