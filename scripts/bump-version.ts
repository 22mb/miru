#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";

// Version lives in exactly one place: the root package.json. Workspace manifests
// carry no `version` (they are private and consumed only via `workspace:*`), so
// there is nothing to keep in sync and no way for the values to drift apart.
const versionRe = /^(\s*"version":\s*")([^"]+)(")/m;

const rootRaw = readFileSync("package.json", "utf8");
const current = rootRaw.match(versionRe)?.[2];
if (!current) throw new Error('Could not find "version" in package.json');

const now = new Date();
const base = `${now.getFullYear()}.${now.getMonth() + 1}.${now.getDate()}`;

let next: string;
if (current === base) {
  next = `${base}.1`;
} else if (current.startsWith(`${base}.`)) {
  next = `${base}.${Number(current.slice(base.length + 1)) + 1}`;
} else {
  next = base;
}

writeFileSync("package.json", rootRaw.replace(versionRe, `$1${next}$3`));
console.log(`${current} -> ${next}`);
