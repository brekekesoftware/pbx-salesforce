import { defineConfig, PluginOption } from 'vite';
import path from 'path';
import fs from 'fs';

// https://vitejs.dev/config/
export default defineConfig({
  base: '',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  plugins: [
    htmlCacheBusterPlugin([
      'webphone.js',
      'widget.js',
      'style.css',
    ]),
  ],
});

function htmlCacheBusterPlugin(assets: string[] = []): PluginOption {
  // const regex = /(?<=(?:src|href)=")(?!https?)(.*?\.\w{2,4})(?=")/g;
  const assetsRegex = new RegExp(`(?<=(?:src|href)=")(?!https?)(.*?(?:${assets.join('|')}))(?=")`, 'g');

  return {
    name: 'html:static-asset-versioning',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: (html, ctx) => {
      const now = Date.now();

      return html.replace(assetsRegex, substring => {
        const path = substring.replace('.', 'public');

        if (!fs.existsSync(path)) {
          console.log('asset not found!', { substring, path });
          return `${substring}?v=${now}`;
        }

        const stats = fs.statSync(path);

        return `${substring}?v=${stats.mtime.valueOf()}`;
      });
    },
  };
}
