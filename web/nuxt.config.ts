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
      // Empty = same origin (API and UI served from same port)
      apiBase: process.env.NUXT_PUBLIC_API_BASE || '',
    },
  },

  // SPA mode — generates static index.html, API server serves it
  ssr: false,

  compatibilityDate: '2025-01-15',
});
