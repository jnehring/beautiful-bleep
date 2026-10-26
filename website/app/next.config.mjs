// SPDX-License-Identifier: MIT
const dev = process.env.NODE_ENV === "development";

/** Static export: the site is plain files, served by Caddy next to the
 *  Brilliant Bleep site (same stack, own section). Caddy proxies /api/* to the
 *  API; `next dev` does the same to a local uvicorn (rewrites need a server,
 *  so they exist only in development). */
const nextConfig = {
  ...(dev ? {} : { output: "export" }),
  trailingSlash: true,
  images: { unoptimized: true },
  ...(dev && { async rewrites() { return [
    { source: "/api/:path*", destination: "http://localhost:8000/api/:path*" },
    { source: "/library/p/:path*", destination: "/library/detail/" },   // Caddy does this in the real setup (sharing.md)
    { source: "/embed/", destination: "/embed/index.html" },
  ]; } }),
};
export default nextConfig;
