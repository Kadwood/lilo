import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vite.config";

/** The browser journeys: `pnpm --filter editor e2e`. Slow (a real browser), so not part of `pnpm test`. */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      environment: "node",
      include: ["e2e/**/*.e2e.ts"],
      testTimeout: 180_000,
      hookTimeout: 120_000,
      fileParallelism: false,
      maxWorkers: 1,
      reporters: ["verbose"],
    },
  }),
);
