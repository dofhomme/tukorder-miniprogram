type Dot = { x: number; y: number; t: number; left: string; top: string }

Component({
  properties: {
    show: { type: Boolean, value: false },
    error: { type: String, value: '' },
    errorSeq: { type: Number, value: 0 },
  },
  data: {
    prompt: '正在出题…',
    image: '',
    imgW: 400,
    imgH: 236,
    dots: [] as Dot[],
    err: '',
    busy: false,
    ready: false,
    challengeId: '',
    loadGen: 0,
  },
  observers: {
    show(on: boolean) {
      if (on) this.load()
      else this.reset()
    },
    errorSeq() {
      const text = String(this.properties.error || '')
      if (!text) return
      this.setData({ err: text, dots: [], busy: false, ready: !!this.data.image })
      if (/重新获取|已失效|验证失败次数|过于频繁/.test(text)) this.load()
    },
  },
  methods: {
    reset() {
      this.setData({
        prompt: '正在出题…',
        image: '',
        dots: [],
        err: '',
        busy: false,
        ready: false,
        challengeId: '',
        loadGen: this.data.loadGen + 1,
      })
    },
    load() {
      const gen = this.data.loadGen + 1
      this.setData({
        prompt: '正在出题…',
        image: '',
        dots: [],
        err: '',
        busy: false,
        ready: false,
        challengeId: '',
        loadGen: gen,
      })
      wx.request({
        url: 'https://imageok.cn/api/auth/human-challenge',
        method: 'POST',
        data: {},
        header: { 'Content-Type': 'application/json' },
        success: (res) => {
          if (gen !== this.data.loadGen) return
          const body = (res.data || {}) as {
            code?: number
            error?: string
            image?: string
            challenge_id?: string
            prompt?: string
            width?: number
            height?: number
          }
          if (body.code !== 200 || !body.image || !body.challenge_id) {
            this.setData({
              err: body.error || '人机验证初始化失败',
              prompt: '请依次点击',
            })
            return
          }
          this.setData({
            challengeId: body.challenge_id,
            prompt: body.prompt || '请依次点击',
            image: 'data:image/png;base64,' + body.image,
            imgW: Number(body.width) || 400,
            imgH: Number(body.height) || 236,
          })
        },
        fail: () => {
          if (gen !== this.data.loadGen) return
          this.setData({ err: '网络异常，请稍后重试', prompt: '请依次点击' })
        },
      })
    },
    onImgLoad() {
      if (this.data.image) this.setData({ ready: true })
    },
    onRetry() {
      if (this.data.busy) return
      this.load()
    },
    onCancel() {
      this.triggerEvent('cancel')
    },
    onTap(e: WechatMiniprogram.TouchEvent) {
      if (!this.data.ready || this.data.busy || this.data.dots.length >= 3) return
      const touch = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0])
      const pageX = touch ? touch.clientX : Number((e.detail as { x?: number }).x)
      const pageY = touch ? touch.clientY : Number((e.detail as { y?: number }).y)
      if (!Number.isFinite(pageX) || !Number.isFinite(pageY)) return
      this.createSelectorQuery()
        .in(this)
        .select('.hc-stage')
        .boundingClientRect((rect) => {
          const box = rect as WechatMiniprogram.BoundingClientRectCallbackResult | null
          if (!box || !box.width || !box.height) return
          const x = ((pageX - box.left) * this.data.imgW) / box.width
          const y = ((pageY - box.top) * this.data.imgH) / box.height
          if (x < 0 || y < 0 || x > this.data.imgW || y > this.data.imgH) return
          const dots = this.data.dots.concat([
            {
              x: Math.round(x),
              y: Math.round(y),
              t: Date.now(),
              left: `${(x / this.data.imgW) * 100}%`,
              top: `${(y / this.data.imgH) * 100}%`,
            },
          ])
          this.setData({ dots })
          if (dots.length < 3) return
          this.setData({ busy: true })
          this.triggerEvent('pass', {
            challengeId: this.data.challengeId,
            points: dots.map((d) => ({ x: d.x, y: d.y, t: d.t })),
          })
        })
        .exec()
    },
  },
})
