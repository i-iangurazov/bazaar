import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  serverExternalPackages: ["pdfkit", "heic-convert", "heic-decode", "libheif-js"],
};

export default withNextIntl(nextConfig);
