import { defineConfig } from 'vitepress';

const repository = 'https://github.com/err0rgod/conduit';

export default defineConfig({
  title: 'Conduit',
  description: 'An open-source, local-first browser-control bridge for AI agents.',
  base: '/conduit/',
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname: 'https://err0rgod.github.io/conduit/' },
  head: [
    ['meta', { name: 'theme-color', content: '#16a085' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Conduit' }],
    [
      'meta',
      {
        property: 'og:description',
        content: 'Connect any AI agent to your browser securely.',
      },
    ],
  ],
  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Conduit',
    search: { provider: 'local' },
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'Security', link: '/security' },
      { text: 'Reference', link: '/browser-tools' },
      { text: 'Roadmap', link: '/roadmap' },
    ],
    sidebar: [
      {
        text: 'Start here',
        items: [
          { text: 'Getting Started', link: '/getting-started' },
          { text: 'Installation', link: '/installation' },
          { text: 'Quick Start', link: '/quick-start' },
        ],
      },
      {
        text: 'Core components',
        items: [
          { text: 'Architecture', link: '/architecture' },
          { text: 'Browser Extension', link: '/browser-extension' },
          { text: 'Daemon', link: '/daemon' },
          { text: 'MCP Server', link: '/mcp-server' },
          { text: 'CLI', link: '/cli' },
        ],
      },
      {
        text: 'Browser control',
        items: [
          { text: 'Browser Tools', link: '/browser-tools' },
          { text: 'Page Snapshots', link: '/page-snapshots' },
        ],
      },
      {
        text: 'Trust and policy',
        items: [
          { text: 'Permissions', link: '/permissions' },
          { text: 'Domain Policies', link: '/domain-policies' },
          { text: 'Remote Devices', link: '/remote-devices' },
          { text: 'Security', link: '/security' },
          { text: 'Prompt Injection', link: '/prompt-injection' },
          { text: 'Configuration', link: '/configuration' },
        ],
      },
      {
        text: 'Maintain Conduit',
        items: [
          { text: 'Testing', link: '/testing' },
          { text: 'Troubleshooting', link: '/troubleshooting' },
          { text: 'Development', link: '/development' },
          { text: 'Contributing', link: '/contributing' },
          { text: 'Roadmap', link: '/roadmap' },
          { text: 'Changelog', link: '/changelog' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: repository }],
    editLink: { pattern: `${repository}/edit/main/apps/docs/:path`, text: 'Edit this page' },
    footer: {
      message: 'Local-first and secure by default. Page content remains untrusted data.',
      copyright: 'Copyright © 2026 Conduit contributors',
    },
    outline: { level: [2, 3] },
  },
});
