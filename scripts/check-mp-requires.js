const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..', 'miniprogram')

function walk(d, a = []) {
  for (const n of fs.readdirSync(d)) {
    if (n === 'vendor' || n === 'node_modules') continue
    const p = path.join(d, n)
    if (fs.statSync(p).isDirectory()) walk(p, a)
    else if (n.endsWith('.js')) a.push(p)
  }
  return a
}

const files = walk(root)
const empty = files.filter((f) => fs.statSync(f).size === 0)
console.log('empty', empty)
const miss = []
for (const f of files) {
  const code = fs.readFileSync(f, 'utf8')
  const re = /require\((['"])(\.\.?\/[^'"]+)\1\)/g
  let m
  while ((m = re.exec(code))) {
    let t = path.resolve(path.dirname(f), m[2])
    if (!t.endsWith('.js')) t += '.js'
    if (!fs.existsSync(t)) miss.push(path.relative(root, f) + ' -> ' + m[2])
  }
}
console.log('missing requires:', miss.length ? miss.join('\n') : 'none')
