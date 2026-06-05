// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
  ],

  devtools: {
    enabled: true,
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    public: {
      // In dev, point at the backend server; in prod (same origin), leave empty.
      apiBase: process.env.NUXT_PUBLIC_API_BASE || (process.env.NODE_ENV === 'development' ? 'http://localhost:3420' : ''),
    },
  },

  // SPA mode — generates static index.html, API server serves it
  ssr: false,

  compatibilityDate: '2025-01-15',
});
