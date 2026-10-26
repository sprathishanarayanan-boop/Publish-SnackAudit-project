// Bundles the React app into client/dist (served by the Express server).
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const out = path.join(__dirname, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(__dirname, 'index.html'), path.join(out, 'index.html'));
fs.copyFileSync(path.join(__dirname, 'favicon.svg'), path.join(out, 'favicon.svg'));

const options = {
  entryPoints: [path.join(__dirname, 'src', 'main.jsx')],
  bundle: true,
  minify: !process.argv.includes('--watch'),
  sourcemap: true,
  outdir: path.join(out, 'assets'),
  entryNames: 'app',
  loader: { '.jsx': 'jsx' },
  jsx: 'automatic',
  target: ['es2020'],
  define: { 'process.env.NODE_ENV': JSON.stringify(process.argv.includes('--watch') ? 'development' : 'production') },
  nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  esbuild.context(options).then((ctx) => ctx.watch());
} else {
  esbuild.build(options).catch(() => process.exit(1));
}
