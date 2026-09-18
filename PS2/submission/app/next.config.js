/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle (only traced node_modules, no full
  // `npm install` needed in the final image) — the standard mode for
  // Docker/Cloud Run per Next.js's own self-hosting guide.
  output: "standalone",
};

module.exports = nextConfig;
