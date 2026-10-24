import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

export const VERSION = pkg.version;
export const PKG_NAME = pkg.name;
