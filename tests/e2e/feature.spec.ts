import { expect, test, type Page } from "@playwright/test";
import { openTwoPeers } from "@baditaflorin/mesh-common/testing";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  name: string;
};
const storagePrefix = pkg.name;

/**
 * Drive a synthetic shake on the holder. `useDeviceMotion` smooths magnitude
 * (`s = 0.6·s + 0.4·m`), so a single event only reaches 40% of its peak —
 * we fire a burst of large-magnitude `devicemotion` events to push the
 * smoothed value past `useShake`'s threshold (16) the same way a real wrist
 * flick would. This exercises the ADVERTISED "shake to fling" path, not the
 * FLING button.
 */
async function synthShake(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (let i = 0; i < 12; i++) {
      window.dispatchEvent(
        new DeviceMotionEvent("devicemotion", {
          // ~70 m/s² total → ~60 after subtracting 1g, well above threshold 16
          accelerationIncludingGravity: { x: 40, y: 40, z: 30 },
        } as DeviceMotionEventInit),
      );
    }
  });
}

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

test("ADVERTISED: a real device-motion shake on the holder flings the potato to the other peer", async ({
  browser,
  baseURL,
}) => {
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

    // Shake the HOLDER — no FLING button click. This is the advertised core
    // action ("shake to fling"). It must cross the mesh.
    await synthShake(holder);

    // Both screens must converge on the OTHER peer holding the potato.
    await expect(other.locator(".potato-display")).toContainText(expectedHolderName, {
      timeout: 5000,
    });
    await expect(holder.locator(".potato-display")).toContainText(expectedHolderName, {
      timeout: 5000,
    });
  } finally {
    await cleanup();
  }
});

test("ADVERTISED: timer expiry eliminates the holder and both peers agree who is out", async ({
  browser,
  baseURL,
}) => {
  // Short round (2s) via the `?round=` override so the timer→elimination
  // loop runs headless without a 15s wait. Both peers load the same URL so
  // they share the same deadline. 2s leaves a comfortable window between the
  // first holder's elimination and the survivor's next deadline.
  const url = (baseURL ?? "") + "?round=2000";
  const { a, b, cleanup } = await openTwoPeers(browser, url, { storagePrefix });
  try {
    await a.getByPlaceholder("your name").fill("alice");
    await b.getByPlaceholder("your name").fill("bob");
    await a.waitForTimeout(700);

    await a.getByRole("button", { name: "start game", exact: true }).click();
    await a.waitForTimeout(400);

    const before = (await a.locator(".potato-display").innerText()).toLowerCase();
    if (!before.includes("alice") && !before.includes("bob"))
      throw new Error("no holder: " + before);

    const eliminatedName = before.includes("alice") ? "alice" : "bob";

    // Let the deadline pass; the holder eliminates itself via a Yjs transact.
    // Poll until BOTH peers render the eliminated player with "(out)".
    const outLocator = (p: Page) =>
      p.locator(".potato-alive li.potato-out", { hasText: eliminatedName });
    await expect(outLocator(a)).toBeVisible({ timeout: 8000 });
    await expect(outLocator(b)).toBeVisible({ timeout: 8000 });

    // And both peers agree it is the SAME single player who is out.
    await expect(a.locator(".potato-alive li.potato-out")).toHaveCount(1);
    await expect(b.locator(".potato-alive li.potato-out")).toHaveCount(1);
    expect(await a.locator(".potato-alive li.potato-out").innerText()).toContain(eliminatedName);
    expect(await b.locator(".potato-alive li.potato-out").innerText()).toContain(eliminatedName);
  } finally {
    await cleanup();
  }
});
