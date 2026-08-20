import path from "node:path"
import { defineConfig } from "vite"

export default defineConfig({
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      lib: path.resolve(import.meta.dirname, "lib"),
      tests: path.resolve(import.meta.dirname, "tests"),
    },
  },
})
