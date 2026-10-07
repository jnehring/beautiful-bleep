// SPDX-License-Identifier: MIT
/** Static export: the site is plain files, served by Caddy next to the
 *  Brilliant Bleep site (same stack, own section). */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};
export default nextConfig;
