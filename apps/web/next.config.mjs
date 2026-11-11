/** Browser requests stay same-origin; the backend also validates APP_URL. */
const origin = process.env.API_URL || 'http://127.0.0.1:4000';
export default {
  output: 'standalone',
  webpack(config) {
    config.output.environment = { ...config.output.environment, asyncFunction: true };
    return config;
  },
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${origin}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
};
