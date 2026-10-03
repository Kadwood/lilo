// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { RecentCard } from "../project/manager";
import { Card } from "./HomeView";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const card = (thumbnail: Uint8Array | null): RecentCard => ({ path: "/p/a.lilo", name: "a", title: "A", modifiedMs: 0, sizeBytes: 1, thumbnail }) as RecentCard;

/** URL.createObjectURL / revokeObjectURL, tracked (jsdom has neither). */
function trackUrls() {
  const live = new Set<string>();
  const revoked = new Set<string>();
  let n = 0;
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: () => {
      const u = `blob:test/${++n}`;
      live.add(u);
      return u;
    },
    revokeObjectURL: (u: string) => {
      live.delete(u);
      revoked.add(u);
    },
  }));
  return { live, revoked };
}

describe("Home recent card thumbnail", () => {
  it("under StrictMode (effects run twice) the image keeps a URL that has not been revoked", () => {
    const { revoked } = trackUrls();
    const { container } = render(
      <StrictMode>
        <ul>
          <Card card={card(new Uint8Array([1, 2, 3]))} onOpen={() => {}} />
        </ul>
      </StrictMode>,
    );
    const src = container.querySelector("img")?.getAttribute("src");
    expect(src).toMatch(/^blob:/);
    expect(revoked.has(src!)).toBe(false);
  });

  it("revokes the URL when the card goes away or its thumbnail changes", () => {
    const { live } = trackUrls();
    const { rerender, unmount } = render(
      <ul>
        <Card card={card(new Uint8Array([1]))} onOpen={() => {}} />
      </ul>,
    );
    expect(live.size).toBe(1);
    rerender(
      <ul>
        <Card card={card(new Uint8Array([2]))} onOpen={() => {}} />
      </ul>,
    );
    expect(live.size).toBe(1);
    unmount();
    expect(live.size).toBe(0);
  });
});
