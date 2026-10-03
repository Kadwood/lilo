import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const run = (...a: string[]) => execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", join(root, "scripts", "import-fonts.mjs"), ...a], { encoding: "utf8" });

describe("generated fonts", () => {
  it("are present and up to date (the test script runs `pnpm fonts` first)", () => {
    expect(run("--ensure")).toMatch(/up to date/);
  }, 120_000);

  it("NOTICE.md lists exactly the generated fonts", () => {
    expect(run("--check-notice")).toMatch(/in sync/);
  });

  it("the pinned commit is printable for CI cache keys", () => {
    expect(run("--print-commit").trim()).toMatch(/^[0-9a-f]{40}$/);
  });
});
