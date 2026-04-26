import type { NextConfig } from 'next'

// pdf-parse/pdfjs-dist assume a real Node module graph; bundling them for the
// server triggers runtime errors (e.g. Object.defineProperty on non-object).
// pdfkit loads Helvetica.afm from its package data dir; ffprobe-static resolves
// its platform binary from __dirname. Bundling breaks those relative paths.
const nextConfig: NextConfig = {
  serverExternalPackages: [
    'pdf-parse',
    'pdfjs-dist',
    '@napi-rs/canvas',
    'pdfkit',
    'ffprobe-static',
  ],
}

export default nextConfig
