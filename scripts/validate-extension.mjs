import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { paths, readJson } from "./shared.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const manifest = await readJson(join(paths.root, "manifest.json"));
const requiredIcons = ["16", "32", "48", "128"];

for (const size of requiredIcons) {
  const iconPath = manifest.icons?.[size];
  if (!iconPath) {
    throw new Error(`Missing manifest icon size ${size}.`);
  }
  await access(join(paths.root, iconPath));
}

for (const size of requiredIcons) {
  const iconPath = manifest.action?.default_icon?.[size];
  if (!iconPath) {
    throw new Error(`Missing action icon size ${size}.`);
  }
  await access(join(paths.root, iconPath));
}

await access(join(paths.root, manifest.action.default_popup));
await access(join(paths.root, manifest.options_page));
await access(join(paths.root, manifest.background.service_worker));

const htmlFiles = ["src/popup.html", "src/options.html"];
for (const file of htmlFiles) {
  const html = await readFile(join(paths.root, file), "utf8");
  if (/[^\x00-\x7F]/.test(html.replace(/[↻⚙×→]/g, ""))) {
    throw new Error(`${file} contains non-ASCII UI copy.`);
  }
}

const jsFiles = ["src/popup.js", "src/options.js", "src/background.js"];
for (const file of jsFiles) {
  await execFileAsync(process.execPath, ["--check", join(paths.root, file)]);
}

console.log("Extension validation passed.");
