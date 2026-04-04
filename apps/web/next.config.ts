import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
    experimental: {
    serverComponentsExternalPackages: ["pdf-parse","pdfkit"],
  },
}

export default nextConfig
