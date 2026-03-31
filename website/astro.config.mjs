// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
  site: 'https://mor.yapping.no',
  base: '/docs',
  integrations: [
    starlight({
      title: 'mor',
      description: 'A shared memory store for humans and AI',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/laat/mor',
        },
      ],
      customCss: ['./src/styles/custom.css'],
      components: {
        ThemeSelect: './src/components/ThemeSelect.astro',
      },
      sidebar: [
        { label: 'Getting Started', slug: 'getting-started' },
        { label: 'CLI', slug: 'cli' },
        {
          label: 'Integration',
          items: [
            { label: 'MCP Server', slug: 'integration/mcp' },
            { label: 'HTTP Server', slug: 'integration/http' },
            { label: 'Remote Access', slug: 'integration/remote' },
          ],
        },
        { label: 'Search', slug: 'search' },
        { label: 'Storage', slug: 'storage' },
        { label: 'Configuration', slug: 'config' },
        { label: 'Embeddings', slug: 'embeddings' },
      ],
    }),
  ],
});
