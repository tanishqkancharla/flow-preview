import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Kept separate from the browser entry so Node never loads React UI modules.
const DEFAULT_DEDUPE = [
  "react",
  "react-dom",
  "react-aria-components",
  "maui",
  "purse-styles",
  "motion",
];

// `dedupe` forces one copy of each package across the preview and the imported source. Narrow
// it when the project pins a different major of one of these (its code would otherwise run
// against the preview's copy).
export function previewConfig({
  directory,
  port,
  sourceRoots = [],
  dedupe = DEFAULT_DEDUPE,
}) {
  return defineConfig({
    root: directory,
    plugins: [react()],
    resolve: { dedupe },
    server: {
      host: "0.0.0.0",
      port,
      strictPort: true,
      allowedHosts: true,
      fs: {
        allow: [
          directory,
          ...sourceRoots.map((root) => path.resolve(directory, root)),
        ],
        deny: [
          "**/.env",
          "**/.env.*",
          "**/*.{crt,pem,key}",
          "**/.git/**",
          "**/.halo/**",
          "**/.amp/**",
        ],
      },
    },
  });
}
