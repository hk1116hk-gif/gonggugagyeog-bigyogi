/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Tesseract.js 워커 파일을 번들에서 제외하고 CDN/정적 경로를 쓰게 한다.
  webpack: (config) => {
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    return config;
  },
};
module.exports = nextConfig;
