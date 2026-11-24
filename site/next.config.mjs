// Hosted on GitHub Pages as a fully static export (see .github/workflows/pages.yml).
//
// The workflow sets NEXT_PUBLIC_BASE_PATH=/silo, because a project site is served
// from https://<user>.github.io/silo/. Leave it unset for local `pnpm dev`, or when
// the site is served from the root of a custom domain.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  // /privacy -> privacy/index.html, so the address works without a redirect.
  trailingSlash: true,
  basePath,
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // site/ lives inside the Expo repo, which has its own lockfile; pin the root here.
  turbopack: {
    root: import.meta.dirname,
  },
}

export default nextConfig
