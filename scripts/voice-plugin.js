/** WechatSI 必须打进预览包和上传包，否则线上不能语音。
 * 电脑模拟器不 requirePlugin，但 app.json 仍要声明，否则真机/体验版/正式版都加载不到插件。
 * Windows 开发者工具 2.02 点「上传」会误报「插件未授权」——那是工具自己去访问插件应用，
 * 不要为了过这个误报而剥插件。发版用 scripts/ci-upload.js（miniprogram-ci）。
 */
const fs = require('fs')
const path = require('path')

const appPath = process.env.MP_APP_JSON
  ? path.resolve(process.env.MP_APP_JSON)
  : path.join(__dirname, '..', 'miniprogram', 'app.json')
const keepPath = path.join(__dirname, '..', '.voice-plugin-keep')

const PLUGIN = {
  WechatSI: {
    version: '0.3.10',
    provider: 'wx069ba97219f66d99',
  },
}

function loadApp() {
  return JSON.parse(fs.readFileSync(appPath, 'utf8'))
}

function saveApp(app) {
  const text = JSON.stringify(app, null, 2) + '\n'
  if (fs.existsSync(appPath) && fs.readFileSync(appPath, 'utf8') === text) return
  fs.writeFileSync(appPath, text)
}

function voicePack(app) {
  const list = app.subPackages
  if (!Array.isArray(list)) return null
  return list.find((p) => p && (p.root === 'pages/voice-pack' || p.name === 'voice')) || null
}

function inject() {
  try {
    fs.writeFileSync(keepPath, '1')
  } catch (_) {}
  const app = loadApp()
  const pack = voicePack(app)
  if (!pack) {
    console.log('[voice-plugin] voice-pack not found')
    return
  }
  pack.plugins = PLUGIN
  saveApp(app)
  console.log('[voice-plugin] WechatSI 0.3.10 on')
}

const cmd = String(process.argv[2] || 'prepare').toLowerCase()
if (cmd === 'strip' || cmd === 'off') {
  console.log('[voice-plugin] refuse strip: 发版必须带语音插件')
  inject()
} else {
  inject()
}
