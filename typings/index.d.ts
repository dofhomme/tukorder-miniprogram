/// <reference path="./types/index.d.ts" />

interface IAppOption {
  globalData: {
    userInfo?: WechatMiniprogram.UserInfo
    /** 对账单预览页间传递（避免分包模块实例拆分导致内存丢失） */
    stmtPreview?: unknown
  }
  userInfoReadyCallback?: WechatMiniprogram.GetUserInfoSuccessCallback
  _bgTimer?: number
  deferBackgroundWork: () => void
}