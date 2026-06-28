#!/usr/bin/env bun
import { appendFileSync, readFileSync } from "node:fs";

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const output = process.env.GITHUB_OUTPUT;
if (!token || !repo) {
  throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY are required");
}

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

const res = await fetch(
  `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(version)}`,
  {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
  },
);
if (res.status !== 200 && res.status !== 404) {
  throw new Error(`Unexpected ${res.status} from GitHub: ${await res.text()}`);
}

const publish = res.status === 404;
if (output) appendFileSync(output, `version=${version}\npublish=${publish}\n`);
console.log(
  publish
    ? `Release ${version} not found; will publish.`
    : `Release ${version} already exists; nothing to publish.`,
);
