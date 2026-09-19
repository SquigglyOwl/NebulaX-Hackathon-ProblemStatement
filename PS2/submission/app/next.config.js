/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle (only traced node_modules, no full
  // `npm install` needed in the final image) — the standard mode for
  // Docker/Cloud Run per Next.js's own self-hosting guide.
  output: "standalone",
  // Next.js blocks cross-origin requests to dev-only assets (HMR, etc.) by
  // default. A cloudflared quick tunnel gets a random *.trycloudflare.com
  // hostname each run, so this is a wildcard rather than one fixed entry —
  // needed for phone testing over a tunnel per README's "Testing on an
  // iPhone" section; irrelevant in production (`next start`/Cloud Run).
  allowedDevOrigins: ["*.trycloudflare.com"],
};

module.exports = nextConfig;
