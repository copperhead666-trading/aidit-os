import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Isolate the build output dir via env so a production build can run on its
  // own port without clobbering a concurrent `next dev` (which keeps `.next`).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Without this, Next's output-file-tracing root inference walks up past
  // this repo and (on this Windows machine) scans into the user profile,
  // hitting an EPERM on C:\Users\ASUS\.ssh — confirmed 2026-08-23. Pinning
  // the root to this repo keeps tracing scoped to files it actually needs.
  experimental: {
    outputFileTracingRoot: __dirname,
    outputFileTracingExcludes: {
      '*': [
        '**/AppData/Roaming/npm/**',
        '**/.ssh/**',
        '**/.codex/**',
        '**/.claude/**',
        '**/.qwen/**',
      ],
    },
  },
};

export default nextConfig;
