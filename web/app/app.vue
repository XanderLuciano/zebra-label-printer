<script setup lang="ts">
useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' },
  ],
  htmlAttrs: {
    lang: 'en',
  },
});

const title = 'Zebra Label Printer';
const description = 'Manage your Zebra GK420d label printer.';

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
});
</script>

<template>
  <UApp>
    <UDashboardGroup>
      <UDashboardSidebar>
        <template #header>
          <NuxtLink to="/" class="flex items-center gap-2 px-1">
            <span class="font-bold text-lg bg-gradient-to-r from-primary-500 to-primary-400 bg-clip-text text-transparent tracking-wide">
              🦓 Zebra Labels
            </span>
          </NuxtLink>
        </template>

        <UNavigationMenu
          :items="[
            { label: 'Dashboard', icon: 'i-lucide-layout-dashboard', to: '/' },
            { label: 'Print History', icon: 'i-lucide-history', to: '/history' },
            { label: 'Queue', icon: 'i-lucide-list-ordered', to: '/queue' },
            { label: 'Debug', icon: 'i-lucide-terminal', to: '/debug' },
            { label: 'Settings', icon: 'i-lucide-settings', to: '/settings' },
          ]"
          orientation="vertical"
          highlight
        />

        <template #footer>
          <UColorModeButton size="xs" />
        </template>
      </UDashboardSidebar>

      <UDashboardPanel>
        <template #body>
          <NuxtPage />
        </template>
      </UDashboardPanel>
    </UDashboardGroup>
  </UApp>
</template>
