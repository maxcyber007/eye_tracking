/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the FastAPI process serves the built files, so the UI stays
  // same-origin with the API. That keeps the HttpOnly session cookie working
  // without CORS credentials, and keeps deployment to a single service.
  output: "export",
  // Mounted by FastAPI at /ui (FRONTEND_MOUNT_PATH).
  basePath: "/ui",
  // Emit /ui/login/index.html so a plain static file server can resolve routes.
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
