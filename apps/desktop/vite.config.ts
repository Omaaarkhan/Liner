import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Production builds get a strict Content-Security-Policy. Dev keeps Vite's
// inline HMR scripts working, so the policy is only added at build time.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  // The trim editor plays downloads through the app's own media scheme (see electron/main.ts).
  "media-src 'self' liner-media:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'"
].join("; ");

function contentSecurityPolicy(): Plugin {
  return {
    name: "content-security-policy",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    }
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), contentSecurityPolicy()],
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: "dist-renderer",
    target: "chrome130"
  }
});
