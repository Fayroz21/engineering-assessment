import { describe, expect, it, vi } from "vitest";
import { MockEmailProvider } from "../notification-provider.js";

const notification = {
  idempotencyKey: "event-1",
  recipient: "customer@example.test",
  customerName: "Amina",
  applicationId: "application-a",
  status: "IN_REVIEW",
};

describe("MockEmailProvider", () => {
  it("delivers to an ordinary address", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const provider = new MockEmailProvider();

    await expect(provider.sendStatusUpdate(notification)).resolves.toBeUndefined();
  });

  // The exercise's stand-in for a temporarily unavailable dependency.
  it("fails for the simulated outage address", async () => {
    const provider = new MockEmailProvider();

    await expect(
      provider.sendStatusUpdate({ ...notification, recipient: "omar@retry.invalid" }),
    ).rejects.toThrow("temporarily unavailable");
  });
});
