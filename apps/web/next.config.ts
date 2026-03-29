import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // pdf-parse and pdfkit use Node.js built-ins that cannot be bundled by webpack.
  // Marking them as external tells Next.js to load them at runtime instead.
  serverExternalPackages: ['pdf-parse', 'pdfkit'],
}

export default nextConfig
