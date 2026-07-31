/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // All data comes from our own Postgres/demo layer at request time.
  experimental: {},
};

module.exports = nextConfig;
