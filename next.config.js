const { siteCsp, baseHeaders } = require('./lib/security-headers');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers: baseHeaders },
      // Report-only until confirmed; /chat gets its own enforced policy from middleware.ts.
      { source: '/((?!chat(?:/|$)).*)', headers: [{ key: 'Content-Security-Policy-Report-Only', value: siteCsp() }] },
    ];
  },
  webpack(config) {
    // ts-mls lazily imports optional code for ciphersuites Secret Chat doesn't use
    // (X448, ChaCha20, ML-KEM, X-Wing, ML-DSA; see CIPHERSUITE in lib/chat/mls.ts).
    // Resolve them to empty modules instead of shipping them.
    const unused = ['@noble/post-quantum/ml-dsa.js', '@hpke/chacha20poly1305', '@hpke/dhkem-x448', '@hpke/ml-kem', '@hpke/hybridkem-x-wing'];
    config.resolve.alias = { ...config.resolve.alias, ...Object.fromEntries(unused.map(m => [m, false])) };
    return config;
  },
};
module.exports = nextConfig;
