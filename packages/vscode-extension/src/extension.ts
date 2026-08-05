import * as vscode from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import { resolveServerCommand } from "./config.js";

let client: LanguageClient | undefined;
let statusBarItem: vscode.StatusBarItem;

async function startClient(context: vscode.ExtensionContext): Promise<void> {
  const command = resolveServerCommand();
  const serverOptions: ServerOptions = { command, transport: TransportKind.stdio };

  const outputChannel = vscode.window.createOutputChannel("Nodum Language Server", { log: true });
  const clientOptions: LanguageClientOptions = {
    // No language filter — nodum reasons over the whole project graph, not
    // one file's language, so every open file is a candidate.
    documentSelector: [{ scheme: "file" }],
    outputChannel,
    traceOutputChannel: outputChannel,
  };

  client = new LanguageClient("nodum", "Nodum Language Server", serverOptions, clientOptions);

  statusBarItem.text = "$(sync~spin) Nodum: connecting…";
  statusBarItem.show();

  try {
    await client.start();
    statusBarItem.text = "$(check) Nodum: connected";
  } catch (error) {
    statusBarItem.text = "$(error) Nodum: failed to start";
    const onPath = command === "nodum-lsp";
    const message = `nodum-lsp failed to start (looked for "${command}"${onPath ? " on PATH" : ""}). See docs/guides/LSP-SETUP.md for install instructions.`;
    const choice = await vscode.window.showErrorMessage(message, "Open Setup Guide");
    if (choice === "Open Setup Guide") {
      void vscode.env.openExternal(
        vscode.Uri.parse("https://github.com/caiquebrito/nodum/blob/main/docs/guides/LSP-SETUP.md"),
      );
    }
    throw error;
  }

  context.subscriptions.push({ dispose: () => void client?.stop() });
}

async function runNodumCommand(command: string): Promise<void> {
  if (!client) {
    void vscode.window.showWarningMessage("Nodum language server is not running.");
    return;
  }
  try {
    const result = await client.sendRequest<unknown>("workspace/executeCommand", { command, arguments: [] });
    if (typeof result === "string") {
      void vscode.window.showInformationMessage(result);
    }
  } catch (error) {
    void vscode.window.showErrorMessage(`Nodum command "${command}" failed: ${String(error)}`);
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("nodum.sync", () => runNodumCommand("nodum.sync")),
    vscode.commands.registerCommand("nodum.deadCode", () => runNodumCommand("nodum.deadCode")),
    vscode.commands.registerCommand("nodum.restartServer", async () => {
      await client?.stop();
      await startClient(context);
    }),
  );

  if (vscode.workspace.workspaceFolders?.length) {
    await startClient(context);
  } else {
    statusBarItem.text = "$(circle-slash) Nodum: no workspace open";
    statusBarItem.show();
  }
}

export async function deactivate(): Promise<void> {
  await client?.stop();
}
