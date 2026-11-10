/** 使用教程。视频地址填 https 的 mp4；域名需加入小程序 downloadFile 合法域名。 */

export const TUTORIAL_SCENES = ['billing', 'goods', 'orders', 'print', 'supply'] as const

export type TutorialScene = (typeof TUTORIAL_SCENES)[number]

export type Tutorial = {
  id: string
  scene: TutorialScene
  titleKey: string
  /** 为空表示视频还没上传 */
  videoUrl: string
}

const SCENE_TITLE: Record<TutorialScene, string> = {
  billing: 'tutSceneBilling',
  goods: 'tutSceneGoods',
  orders: 'tutSceneOrders',
  print: 'tutScenePrint',
  supply: 'tutSceneSupply',
}

export const TUTORIALS: Tutorial[] = [
  { id: 'bill-voice', scene: 'billing', titleKey: 'tutBillVoice', videoUrl: 'https://api.imageok.cn/downloads/tutorials/yuyinkaidan0EE1CA7C-4AF8-40c8-9CA5-37CF575FE520.mp4' },
  { id: 'bill-print', scene: 'billing', titleKey: 'tutBillPrint', videoUrl: 'https://api.imageok.cn/downloads/tutorials/0EE1CA7C-4AF8-40c8-9CA5-37CF575FE520.mp4' },
  { id: 'bill-return', scene: 'billing', titleKey: 'tutBillReturn', videoUrl: 'https://api.imageok.cn/downloads/tutorials/tuidandayin0EE1CA7C-4AF8-40c8-9CA5-37CF575FE520.mp4' },
  { id: 'goods-edit', scene: 'goods', titleKey: 'tutGoodsEdit', videoUrl: 'https://api.imageok.cn/downloads/tutorials/shangpinzengjia0EE1CA7C-4AF8-40c8-9CA5-37CF575FE520.mp4' },
  { id: 'goods-sku', scene: 'goods', titleKey: 'tutGoodsSku', videoUrl: 'https://api.imageok.cn/downloads/tutorials/yansechima0EE1CA7C-4AF8-40c8-9CA5-37CF575FE520.mp4' },
  { id: 'orders-day', scene: 'orders', titleKey: 'tutOrdersDay', videoUrl: 'https://api.imageok.cn/downloads/tutorials/chakanzhangdan0EE1CA7C-4AF8-40c8-9CA5-37CF575FE5201.mp4' },
  { id: 'orders-ship', scene: 'orders', titleKey: 'tutOrdersShip', videoUrl: 'https://api.imageok.cn/downloads/tutorials/shoukuanshouhuo0EE1CA7C-4AF8-40c8-9CA5-37CF575FE520.mp4' },
  { id: 'print-ble', scene: 'print', titleKey: 'tutPrintBle', videoUrl: 'https://api.imageok.cn/downloads/tutorials/lianjielanya0EE1CA7C-4AF8-40c8-9CA5-37CF575FE520.mp4' },
  { id: 'print-flags', scene: 'print', titleKey: 'tutPrintFlags', videoUrl: 'https://api.imageok.cn/downloads/tutorials/bianhaoqiankuan0EE1CA7C-4AF8-40c8-9CA5-37CF575FE520.mp4' },
  { id: 'supply-accept', scene: 'supply', titleKey: 'tutSupplyAccept', videoUrl: 'https://api.imageok.cn/downloads/tutorials/miamliaoyanshou0EE1CA7C-4AF8-40c8-9CA5-37CF575FE520.mp4' },
  { id: 'supply-cost', scene: 'supply', titleKey: 'tutSupplyCost', videoUrl: 'https://api.imageok.cn/downloads/tutorials/chengbenguanlian0EE1CA7C-4AF8-40c8-9CA5-37CF575FE520.mp4' },
]

/** 教程入口始终可进。某条 videoUrl 为空时，播放页显示「视频准备中」。 */
export function tutorialsEnabled(): boolean {
  return true
}

export function sceneTitleKey(scene: TutorialScene): string {
  return SCENE_TITLE[scene]
}

export function isTutorialScene(value: string): value is TutorialScene {
  return (TUTORIAL_SCENES as readonly string[]).includes(value)
}

export function findTutorial(id: string): Tutorial | undefined {
  return TUTORIALS.find((item) => item.id === id)
}
