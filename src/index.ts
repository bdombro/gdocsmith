#!/usr/bin/env bun
/* Thin CLI entry — delegates to argsbarg runtime. */

import { Cli } from "argsbarg";
import { program } from "./program.ts";

/** Main CLI runner instance. */
const cli = new Cli(program);
await cli.run();
