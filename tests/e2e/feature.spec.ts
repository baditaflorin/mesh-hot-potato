import { expect, test } from "@playwright/test";
import { openTwoPeers } from "@baditaflorin/mesh-common/testing";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  name: string;
};
const storagePrefix = pkg.name;

test("start + fling moves the potato between peers", async ({ browser, baseURL }) => {
  const { a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    await a.getByPlaceholder("your name").fill("alice");
    await b.getByPlaceholder("your name").fill("bob");
    await a.waitForTimeout(700);

    await a.getByRole("button", { name: "start game", exact: true }).click();
    await a.waitForTimeout(400);

    const before = (await a.locator(".potato-display").innerText()).toLowerCase();
    if (!before.includes("alice") && !before.includes("bob"))
      throw new Error("no holder: " + before);

    const holder = before.includes("alice") ? a : b;
    const other = before.includes("alice") ? b : a;
    const expectedHolderName = before.includes("alice") ? "bob" : "alice";

    await holder.getByRole("button", { name: "FLING", exact: true }).click();
    await other.waitForTimeout(400);

    await expect(other.locator(".potato-display")).toContainText(expectedHolderName);
  } finally {
    await cleanup();
  }
});
