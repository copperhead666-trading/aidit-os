// Adapted from FounderOS-DEMO d5e565e, MIT.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Isolate the build output dir via env so a production build can run on its
  // own port without clobbering a concurrent `next dev` (which keeps `.next`).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Tracing is only needed for standalone output; here it scans the user
  // profile (WindowsApps aliases) and fails with EACCES, so it is off.
  outputFileTracing: false,
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', 'node-ical', 'nodemailer'],
    // Pin tracing to this repo: on this Windows machine the inferred root walks
    // into the user profile and hits EACCES on WindowsApps/bash.exe.
    outputFileTracingRoot: __dirname,
    outputFileTracingExcludes: {
      '*': ['**/AppData/**', '**/.ssh/**', '**/.codex/**', '**/.claude/**'],
    },
  },
};

export default nextConfig;
