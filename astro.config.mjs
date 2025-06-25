// @ts-check
import { defineConfig } from 'astro/config'

import sitemap from '@astrojs/sitemap'

import tailwindcss from '@tailwindcss/vite'

import pagefind from 'astro-pagefind'

// https://astro.build/config
export default defineConfig({
  prefetch: {
    prefetchAll: true
  },
  site: 'https://modules.lsposed.org',

  integrations: [
    sitemap(),
    pagefind({
      indexConfig: {
        forceLanguage: 'zh'
      }
    })
  ],

  vite: {
    plugins: [tailwindcss()]
  }
})
