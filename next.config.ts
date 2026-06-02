import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	serverExternalPackages: ["better-sqlite3", "sqlite-vec", "officeparser"],
	devIndicators: false,
};

export default nextConfig;
