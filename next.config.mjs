/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Uploaded/venue photos are stored as data: URLs or arbitrary external
    // URLs (via the "URL로 추가" fallback), so we render them with plain
    // <img> tags rather than next/image, which needs known remote hosts.
  },
};

export default nextConfig;
