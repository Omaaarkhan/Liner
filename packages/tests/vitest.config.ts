import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  resolve: {
    alias: {
      "@audio-ripper/core": path.resolve(__dirname, "../core/src/index.ts"),
      "@audio-ripper/shared": path.resolve(__dirname, "../shared/src/index.ts")
    }
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
});
