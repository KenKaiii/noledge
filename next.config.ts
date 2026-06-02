import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	serverExternalPackages: [
		"better-sqlite3",
		"sqlite-vec",
		"officeparser",
		"tesseract.js",
		"tesseract.js-core",
	],
	devIndicators: false,
};

export default nextConfig;
