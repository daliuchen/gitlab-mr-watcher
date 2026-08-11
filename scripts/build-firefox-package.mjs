import { join } from "node:path";
import { copyPackageFiles, paths, prepareDir, readJson, writeJson, zipDirectory } from "./shared.mjs";

const firefoxBuildDir = join(paths.build, "firefox");
await prepareDir(firefoxBuildDir);
await copyPackageFiles(firefoxBuildDir);

const manifestPath = join(firefoxBuildDir, "manifest.json");
const manifest = await readJson(manifestPath);
manifest.browser_specific_settings = {
  gecko: {
    id: "gitlab-mr-watcher@daliuchen.github.io",
    strict_min_version: "109.0"
  }
};

await writeJson(manifestPath, manifest);
await zipDirectory(firefoxBuildDir, join(paths.dist, "gitlab-mr-watcher-firefox.zip"));
console.log("Created dist/gitlab-mr-watcher-firefox.zip");
