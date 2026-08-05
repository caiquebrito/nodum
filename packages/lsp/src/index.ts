#!/usr/bin/env node
import { ensureLiftoffOnly } from "@caiquebrito/nodum-core";
ensureLiftoffOnly();

import { createConnection, ProposedFeatures } from "vscode-languageserver/node";
import { createServer } from "./server.js";

// createConnection(ProposedFeatures.all) alone does NOT default to stdio —
// confirmed via a real spawned-process check: it throws "Connection input
// stream is not set" unless the caller passes `--stdio` on the command
// line. Binding process.stdin/stdout explicitly here means `nodum-lsp`
// works with zero required flags, matching spec 072's "starts over stdio"
// acceptance criterion literally.
createServer(createConnection(ProposedFeatures.all, process.stdin, process.stdout)).start();
