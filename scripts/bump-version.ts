#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { Glob } from "bun";

const targets = ["package.json", ...new Glob("packages/*/package.json").scanSync()];
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

for (const path of targets) {
  const raw = readFileSync(path, "utf8");
  writeFileSync(path, raw.replace(versionRe, `$1${next}$3`));
}
console.log(`${current} -> ${next} (${targets.length} files)`);
