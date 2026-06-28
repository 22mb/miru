#!/usr/bin/env bun
import { readdirSync, rmSync, unlinkSync } from "node:fs";

rmSync("packages/server/src/assets", { recursive: true, force: true });
for (const f of readdirSync(".")) if (f.endsWith(".bun-build")) unlinkSync(f);
