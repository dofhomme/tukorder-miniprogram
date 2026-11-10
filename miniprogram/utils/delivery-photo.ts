/** 已送货取图：拍照 / 相册（对齐 App OrderShipFulfillmentFields） */

export type DeliveryPickSource = 'camera' | 'album'

/** 选择一张送货照片，返回本地临时/持久路径 */
export function pickDeliveryImage(
  source: DeliveryPickSource,
): Promise<string> {
  const sourceType = source === 'camera' ? ['camera'] : ['album']

  const viaChooseImage = () =>
    new Promise<string>((resolve, reject) => {
      wx.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: sourceType as ('album' | 'camera')[],
        success: (res) => {
          const path = (res.tempFilePaths || [])[0] || ''
          if (!path) reject(new Error('未选择图片'))
          else resolve(path)
        },
        fail: (err) => {
          const msg = String(err?.errMsg || '')
          if (/cancel/i.test(msg)) reject(new Error('cancel'))
          else reject(new Error(msg || '选择图片失败'))
        },
      })
    })

  if (typeof wx.chooseMedia !== 'function') {
    return viaChooseImage()
  }

  return new Promise((resolve, reject) => {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: sourceType as any,
      sizeType: ['compressed'],
      success: (res) => {
        const path = (res.tempFiles || [])[0]?.tempFilePath || ''
        if (!path) reject(new Error('未选择图片'))
        else resolve(path)
      },
      fail: (err) => {
        const msg = String(err?.errMsg || '')
        if (/cancel/i.test(msg)) {
          reject(new Error('cancel'))
          return
        }
        // 部分基础库 / 开发者工具 chooseMedia 异常时回退 chooseImage
        viaChooseImage().then(resolve, reject)
      },
    })
  })
}

/** 落盘到用户目录，失败则返回原临时路径 */
export function persistDeliveryLocalPath(tempPath: string): string {
  const fs = wx.getFileSystemManager()
  const dest = `${wx.env.USER_DATA_PATH}/order_deliv_${Date.now()}.jpg`
  try {
    fs.saveFileSync(tempPath, dest)
    return dest
  } catch (_) {
    try {
      fs.copyFileSync(tempPath, dest)
      return dest
    } catch (_) {
      return tempPath
    }
  }
}

/** 读文件为 base64（不含 data: 前缀） */
export function readLocalFileBase64(path: string): string {
  if (!path) return ''
  if (path.startsWith('data:')) {
    const i = path.indexOf('base64,')
    return i >= 0 ? path.slice(i + 7) : ''
  }
  const fs = wx.getFileSystemManager()
  try {
    return String(fs.readFileSync(path, 'base64') || '')
  } catch (_) {
    return ''
  }
}

/** 把送货照 base64 落到本地文件，避免 data URI 在真机上空白 */
function writeDeliveryBase64File(b64: string): string {
  const pure = String(b64 || '').replace(/\s/g, '')
  if (pure.length < 64) return ''
  const tag = `${pure.length}_${pure.slice(0, 24).replace(/[^A-Za-z0-9]/g, '')}`
  const dest = `${wx.env.USER_DATA_PATH}/order_deliv_view_${tag}.jpg`
  const fs = wx.getFileSystemManager()
  try {
    fs.accessSync(dest)
    return dest
  } catch (_) {
    /* not exists */
  }
  try {
    fs.writeFileSync(dest, pure, 'base64')
    return dest
  } catch (_) {
    return ''
  }
}

/**
 * 展示用 src：本地路径 / http / dataURI / 纯 base64。
 * 注意：JPEG base64 几乎一定含 `/`，且常以 `/9j/` 开头，不能当路径判断。
 */
export function deliveryPhotoSrc(
  pathOrB64?: string | null,
  _hasPhoto?: boolean,
): string {
  const raw = (pathOrB64 || '').trim()
  if (!raw) return ''
  if (
    raw.startsWith('data:') ||
    raw.startsWith('wxfile:') ||
    raw.startsWith('http://') ||
    raw.startsWith('https://')
  ) {
    return raw
  }

  const compact = raw.replace(/\s/g, '')
  // JPEG/PNG 等纯 base64（可含 + / =）；JPEG 常见前缀 /9j/
  const looksLikeBase64 =
    compact.length > 64 &&
    (compact.startsWith('/9j/') ||
      compact.startsWith('iVBOR') ||
      compact.startsWith('R0lGOD') ||
      compact.startsWith('UklGR') ||
      /^[A-Za-z0-9+/]+=*$/.test(compact))

  if (looksLikeBase64) {
    const file = writeDeliveryBase64File(compact)
    if (file) return file
    return `data:image/jpeg;base64,${compact}`
  }

  // 本地文件路径
  return raw
}
