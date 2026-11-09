import assert from "node:assert/strict";
import { test } from "vitest";
import { ChatController } from "../src/main/chat-controller";
import { SpawnedCodexAppServerClient } from "../src/main/codex-app-server-client";

test("connects to the locally installed and authenticated Codex app-server", async () => {
  const controller = new ChatController({
    createClient: () => new SpawnedCodexAppServerClient(),
    workingDirectory: process.cwd()
  });
  try {
    const snapshot = await controller.connect();
    assert.equal(snapshot.connection, "ready", snapshot.connectionDetail);
    assert.notEqual(snapshot.allowance.phase, "loading");
  } finally {
    controller.close();
  }
}, 30_000);

test("the authenticated Codex app-server reports image-generation capability", async () => {
  const client = new SpawnedCodexAppServerClient();
  try {
    await client.initialize({
      name: "deep-reading-memory-image-diagnostic",
      title: "Deep Reading Memory Image Diagnostic",
      version: "0.1.0"
    });
    const account = await client.readAccount();
    assert.notEqual(account.account, null, "Codex account is not signed in");
    const capabilities = await client.request("modelProvider/capabilities/read", {});
    assert.equal(
      (capabilities as { imageGeneration?: boolean }).imageGeneration,
      true,
      `Unexpected capabilities: ${JSON.stringify(capabilities)}`
    );
  } finally {
    client.close();
  }
}, 30_000);
