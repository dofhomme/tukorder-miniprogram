const PREFIX = 'tuk_shop_logo_'

function pureLogo(b64: string): string {
  return String(b64 || '')
    .replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '')
    .replace(/\s/g, '')
}

/** 空串、过短或不是图片头的内容不当成 Logo，避免预览画出一块空白 */
export function logoPayloadOk(b64: string): boolean {
  const pure = pureLogo(b64)
  if (pure.length < 64) return false
  return (
    pure.indexOf('/9j/') === 0 ||
    pure.indexOf('iVBORw0') === 0 ||
    pure.indexOf('UklGR') === 0 ||
    pure.indexOf('R0lGOD') === 0
  )
}

function contentTag(pure: string): string {
  let h = 5381
  for (let i = 0; i < pure.length; i++) h = ((h << 5) + h + pure.charCodeAt(i)) | 0
  return `${pure.length.toString(36)}${(h >>> 0).toString(36)}`
}

/** 店铺 Logo base64 落盘；同内容复用同一文件，换图时删掉旧文件（用户目录上限 10MB） */
export function writeShopLogoFile(b64: string): string {
  const pure = pureLogo(b64)
  if (!logoPayloadOk(pure)) return ''
  let base = ''
  try {
    base = (wx.env && wx.env.USER_DATA_PATH) || ''
  } catch (_) {}
  if (!base) return ''
  const name = `${PREFIX}${contentTag(pure)}.jpg`
  const dest = `${base}/${name}`
  const fs = wx.getFileSystemManager()
  try {
    fs.accessSync(dest)
    return dest
  } catch (_) {}
  try {
    for (const f of fs.readdirSync(base)) {
      if (f.indexOf(PREFIX) === 0 && f !== name) {
        try {
          fs.unlinkSync(`${base}/${f}`)
        } catch (_) {}
      }
    }
  } catch (_) {}
  try {
    fs.writeFileSync(dest, pure, 'base64')
    return dest
  } catch (_) {
    return ''
  }
}

function userDataBase(): string {
  try {
    return (wx.env && wx.env.USER_DATA_PATH) || ''
  } catch (_) {
    return ''
  }
}

function fileLooksLikeLogo(path: string): boolean | null {
  try {
    const b64 = String(wx.getFileSystemManager().readFileSync(path, 'base64') || '')
    return logoPayloadOk(b64)
  } catch (_) {
    return null
  }
}

/** 缓存里没有 base64 时，仍用上次落盘的 Logo。空文件删掉，不当成图 */
export function existingShopLogoPath(): string {
  const base = userDataBase()
  if (!base) return ''
  try {
    const names = wx.getFileSystemManager().readdirSync(base)
    for (let i = 0; i < names.length; i++) {
      if (names[i].indexOf(PREFIX) !== 0) continue
      const path = `${base}/${names[i]}`
      const ok = fileLooksLikeLogo(path)
      if (ok === true) return path
      if (ok === false) {
        try {
          wx.getFileSystemManager().unlinkSync(path)
        } catch (_) {}
      }
    }
  } catch (_) {}
  return ''
}

/** 画布读本地图时用。按文件头区分 png / jpeg，避免后缀不对导致加载失败 */
export function shopLogoDataUrl(path: string): string {
  if (!path) return ''
  try {
    const b64 = String(wx.getFileSystemManager().readFileSync(path, 'base64') || '')
    if (!logoPayloadOk(b64)) return ''
    const mime = b64.indexOf('iVBORw0') === 0 ? 'image/png' : 'image/jpeg'
    return `data:${mime};base64,${b64}`
  } catch (_) {
    return ''
  }
}
