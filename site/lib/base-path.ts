/**
 * Prefix for files served from public/. next/link adds the base path itself, but
 * plain <img> sources and metadata icon URLs are emitted verbatim, so on the
 * GitHub Pages project site (served under /silo) they need it added by hand.
 * Empty in local dev and on a custom domain.
 */
export const withBasePath = (path: string) => `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}${path}`
