#!/usr/bin/env bun
/*
Thin CLI entry — delegates to argsbarg runtime.
*/

import { Cli } from "argsbarg";
import { program } from "./program.ts";

const cli = new Cli(program);
await cli.run();
