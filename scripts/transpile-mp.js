const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const { minify } = require('terser')

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'vendor' || name === 'node_modules') continue
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

function isPageOrApp(file, source) {
  const base = path.basename(file)
  if (base === 'app.ts') return true
  // 只剥真正的 Page/Component 入口；pages/ 下的辅助模块必须保留 exports
  if (!/[\\/](pages|components|custom-tab-bar)[\\/]/i.test(file)) return false
  return /\b(Page|Component|App)\s*\(/.test(source)
}

/** Page/App 入口不要带 exports，否则部分基础库下事件绑定会异常 */
function stripPageExports(code) {
  return code
    .replace(/Object\.defineProperty\(exports,\s*"__esModule",\s*\{\s*value:\s*true\s*\}\);\r?\n?/g, '')
    .replace(/^exports\.[^\n]+=\s*void 0;\r?\n?/gm, '')
    .replace(/^exports\.[^\n]+;\r?\n?/gm, '')
}

async function shrink(code, file) {
  const result = await minify(code, {
    compress: { passes: 2 },
    mangle: { safari10: true },
    output: { comments: false },
  })
  if (!result || !result.code) {
    throw new Error('minify empty: ' + file)
  }
  return result.code
}

async function main() {
  const root = path.join(__dirname, '..', 'miniprogram')
  let before = 0
  let after = 0
  for (const file of walk(root)) {
    const code = fs.readFileSync(file, 'utf8')
    let out = ts.transpileModule(code, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2017,
        esModuleInterop: true,
      },
      fileName: file,
    }).outputText
    if (isPageOrApp(file, code)) out = stripPageExports(out)
    const raw = Buffer.byteLength(out)
    out = await shrink(out, file)
    const dest = file.replace(/\.ts$/, '.js')
    fs.writeFileSync(dest, out, 'utf8')
    before += raw
    after += Buffer.byteLength(out)
    console.log(dest)
  }
  console.log('js ' + before + ' -> ' + after)
  const { mainBytes, LIMIT } = require('./main-size')
  const report = mainBytes()
  console.log('main ' + (report.bytes / 1024 / 1024).toFixed(2) + ' MB')
  if (report.bytes > LIMIT) {
    console.error('main package over 1.9MB')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
