import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n.ts");
// Local verification can bound worker parallelism on a MacBook Air.
const buildCpus = Number(process.env.BAZAAR_BUILD_CPUS);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...([1, 2, 3, 4].includes(buildCpus) ? { experimental: { cpus: buildCpus } } : {}),
  output: "standalone",
  outputFileTracingExcludes: {
    "*": ["./tmp/**/*", "./artifacts/**/*", "./.local/**/*"],
  },
  serverExternalPackages: ["pdfkit", "heic-convert", "heic-decode", "libheif-js"],
};

export default withNextIntl(nextConfig);
