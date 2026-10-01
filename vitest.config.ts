import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Only Faultline's tests: target repository sources/tests are inert data.
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    exclude: ["fixtures/**", "node_modules/**", ".next/**"],
    passWithNoTests: false,
  },
});
