#!/usr/bin/env node
/**
 * phpustik — MCP server entry point.
 *
 * This file is intentionally tiny. Its only job is to invoke
 * `main()` from `./server.js`, which performs the real bootstrap.
 *
 * Keeping the entry point separate from the bootstrap module makes
 * the bootstrap function unit-testable and lets the package be
 * re-used programmatically.
 */

import { main } from './server.js';

await main();
