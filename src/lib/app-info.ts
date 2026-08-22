import { createRequire } from "node:module";

interface PackageMetadata {
  version: string;
}

const require = createRequire(import.meta.url);
const packageMetadata = require("../../package.json") as PackageMetadata;

export const APP_VERSION = packageMetadata.version;
