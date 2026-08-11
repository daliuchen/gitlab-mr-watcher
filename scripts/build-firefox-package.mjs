import { join } from "node:path";
import { copyPackageFiles, paths, prepareDir, readJson, writeJson, zipDirectory } from "./shared.mjs";

const firefoxBuildDir = join(paths.build, "firefox");
await prepareDir(firefoxBuildDir);
await copyPackageFiles(firefoxBuildDir);

const manifestPath = join(firefoxBuildDir, "manifest.json");
const manifest = await readJson(manifestPath);
manifest.background = {
  scripts: ["src/background.js"]
};
manifest.browser_specific_settings = {
  gecko: {
    id: "gitlab-mr-watcher@daliuchen.github.io",
    strict_min_version: "140.0",
    data_collection_permissions: {
      required: ["none"]
    }
  }
};

await writeJson(manifestPath, manifest);
await zipDirectory(firefoxBuildDir, join(paths.dist, "gitlab-mr-watcher-firefox.zip"));
console.log("Created dist/gitlab-mr-watcher-firefox.zip");
