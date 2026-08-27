import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchApplication } from "../api.js";

function stubFetch(response: Partial<Response>) {
  const fetchMock = vi.fn().mockResolvedValue(response as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchApplication", () => {
  it("sends the customer identity and returns the parsed application", async () => {
    const application = { id: "application-a", status: "SUBMITTED" };
    const fetchMock = stubFetch({ ok: true, json: async () => application });

    await expect(fetchApplication("application-a")).resolves.toEqual(application);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/v1/applications/application-a");
    expect(init.headers["x-customer-id"]).toBeTruthy();
    expect(init.cache).toBe("no-store");
  });

  it.each([404, 401, 500])("throws on a %s response", async (status) => {
    stubFetch({ ok: false, status });

    await expect(fetchApplication("application-a")).rejects.toThrow(
      String(status),
    );
  });
});
