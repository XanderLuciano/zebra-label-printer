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

  // The template engine and ZPL font metrics live in the backend package
  // (../src), so the designer canvas and server-side template rendering share one
  // implementation instead of drifting apart. Vite's dev server refuses to serve
  // files above its root unless told otherwise, so the composables that
  // re-export them would 404 under `npm run dev` without this. Production
  // builds bundle the files and don't need it.
  vite: {
    server: {
      fs: {
        allow: ['..'],
      },
    },
  },
});
