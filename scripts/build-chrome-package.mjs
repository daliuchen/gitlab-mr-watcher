import { join } from "node:path";
import { copyPackageFiles, paths, prepareDir, zipDirectory } from "./shared.mjs";

const chromeBuildDir = join(paths.build, "chrome");
await prepareDir(chromeBuildDir);
await copyPackageFiles(chromeBuildDir);
await zipDirectory(chromeBuildDir, join(paths.dist, "gitlab-me-mr-chrome.zip"));
console.log("Created dist/gitlab-me-mr-chrome.zip");
