import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const htmlPath = path.join(rootDir, 'index.html');
const cssPath = path.join(rootDir, 'styles.css');
const logicPath = path.join(rootDir, 'logic.mjs');
const scriptPath = path.join(rootDir, 'script.mjs');
const outputPath = path.join(rootDir, 'SAI_GC_MVP_ABRIR.html');

const html = fs.readFileSync(htmlPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');
const logic = fs.readFileSync(logicPath, 'utf8').replace(/^export\s+/gm, '');
const script = fs.readFileSync(scriptPath, 'utf8').replace(/import\s*\{[\s\S]*?\}\s*from\s*'\.\/logic\.mjs';\s*/, '');

const standalone = html
  .replace(
    '<title>SAI-GC | Centro de Atención y Gestión de Capacidad (MVP R01)</title>',
    '<title>SAI-GC | Centro de Atención y Gestión de Capacidad (MVP R02 Autocontenido)</title>'
  )
  .replace(
    '<link rel="stylesheet" href="styles.css">',
    `<style>\n${css}\n</style>`
  )
  .replace(
    '<script type="module" src="script.mjs"></script>',
    `<script>\n${logic}\n${script}\n</script>`
  );

fs.writeFileSync(outputPath, standalone, 'utf8');
console.log(`[build_standalone] Generated ${outputPath} (${standalone.length} bytes) successfully.`);
