'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')

async function build () {
  const pkg = require('../package.json')
  const out = path.join(root, 'release', 'chrome-extension')
  await fs.rm(out, { recursive: true, force: true })
  await fs.mkdir(out, { recursive: true })
  await fs.cp(path.join(root, 'src/renderer'), out, { recursive: true })
  await fs.cp(path.join(root, 'src/extension'), out, { recursive: true })
  // Desktop file:// sandbox cannot load external files; MV3 requires packaged scripts.
  const gamePath = path.join(out, 'games/jimao/index.html')
  const gameHTML = await fs.readFile(gamePath, 'utf8')
  const gameScript = gameHTML.match(/<script>([\s\S]*?)<\/script>/)
  if (!gameScript) throw new Error('Missing bundled game script')
  await fs.writeFile(path.join(out, 'games/jimao/game.js'), gameScript[1])
  await fs.writeFile(gamePath, gameHTML.replace(gameScript[0], '<script src="game.js"></script>'))
  await fs.copyFile(path.join(root, 'build/icon.png'), path.join(out, 'icon.png'))
  await fs.copyFile(path.join(root, 'LICENSE'), path.join(out, 'LICENSE'))
  const manifest = JSON.parse(await fs.readFile(path.join(out, 'manifest.json'), 'utf8'))
  manifest.version = pkg.version
  await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  let html = await fs.readFile(path.join(out, 'index.html'), 'utf8')
  html = html.replace(/  <meta http-equiv="Content-Security-Policy"[^>]+>\n/, '')
  html = html.replace('  <script src="app.js"></script>', '  <script src="hash.js"></script>\n  <script src="bridge.js"></script>\n  <script src="app.js"></script>')
  html = html.replace('</body>', '  <script src="extension-ui.js"></script>\n</body>')
  await fs.writeFile(path.join(out, 'index.html'), html)
  if (process.argv.includes('--zip')) {
    const zip = path.join(root, 'release', `Mozi-${pkg.version}-chrome.zip`)
    await fs.rm(zip, { force: true })
    if (process.platform === 'win32') {
      const q = (s) => "'" + s.replace(/'/g, "''") + "'"
      execFileSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path ${q(out + '/*')} -DestinationPath ${q(zip)}`])
    } else execFileSync('zip', ['-qr', zip, '.'], { cwd: out })
    console.log(`ZIP: ${zip}`)
  }
  console.log(`Chrome → chrome://extensions → 开发者模式 → 加载已解压的扩展程序: ${out}`)
}
build().catch((err) => { console.error(err); process.exitCode = 1 })
