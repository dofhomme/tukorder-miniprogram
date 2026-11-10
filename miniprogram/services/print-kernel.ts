import { chunkEscPos, chunkRaw, isRasterEscPos } from './escpos'
import {
  effectiveGear,
  effectivePrintParams,
  notePrintSuccess,
  reportPrintTelemetry,
  stepDownGear,
} from './print-runtime-policy'

let _chain: Promise<void> = Promise.resolve()

export function enqueuePrint<T>(task: () => Promise<T>): Promise<T> {
  const run = _chain.then(task, task)
  _chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

export type PrintChunkWriter = (chunk: Uint8Array) => Promise<void>

export async function kernelWriteEscPos(opts: {
  channel: string
  platform: string
  data: Uint8Array
  writeChunk: PrintChunkWriter
  reconnectOnce?: () => Promise<boolean>
}): Promise<void> {
  const { channel, platform, data, writeChunk, reconnectOnce } = opts
  if (!data.length) return
  const params = await effectivePrintParams(channel)
  const gear = await effectiveGear(channel)
  const raster = isRasterEscPos(data)
  const started = Date.now()
  let errorClass = ''

  const paced = async (payload: Uint8Array) => {
    const delay = params.rasterIntervalMs
    // 安卓不走苹果那套缓冲停顿；整票交给 BLE 按 244/MTU 连发
    if (channel === 'mpAndroidBle') {
      await writeChunk(payload)
      return
    }
    const chunks = raster
      ? chunkRaw(payload, params.chunkBytes)
      : chunkEscPos(payload, params.chunkBytes)
    for (let i = 0; i < chunks.length; i++) {
      await writeChunk(chunks[i])
      if (i < chunks.length - 1 && delay > 0) await sleep(delay)
      if (
        channel === 'mpIosBle' &&
        params.iosBufferPauseEvery > 0 &&
        i > 0 &&
        i % params.iosBufferPauseEvery === 0 &&
        params.iosBufferPauseMs > 0
      ) {
        await sleep(params.iosBufferPauseMs)
      }
    }
    if (channel === 'mpIosBle' && params.postWriteMs > 0) await sleep(params.postWriteMs)
  }

  const probe = async () => {
    await writeChunk(new Uint8Array([0x1b, 0x40]))
  }

  try {
    if (data.length > 64 && channel !== 'mpAndroidBle') {
      try {
        await probe()
      } catch (e) {
        errorClass = classify(e)
        if (reconnectOnce) {
          const re = await reconnectOnce()
          if (!re) throw e
          await probe()
        } else {
          throw e
        }
      }
      if (channel === 'mpIosBle') {
        await sleep(Math.min(40, Math.max(4, params.postWriteMs)))
      }
    }
    try {
      await paced(data)
      // 安卓 NR 写完回调早于打印机排空；稍等再返回，避免票尾最后几包还在空中就被撕/切
      if (channel === 'mpAndroidBle') await sleep(80)
    } catch (e) {
      errorClass = classify(e)
      if (reconnectOnce) {
        const re = await reconnectOnce()
        if (!re) throw e
        await paced(data)
      } else {
        throw e
      }
    }
    await notePrintSuccess(channel)
    void reportPrintTelemetry({
      platform,
      channel,
      gear,
      bytes: data.length,
      durationMs: Date.now() - started,
    })
  } catch (e) {
    await stepDownGear(channel)
    void reportPrintTelemetry({
      platform,
      channel,
      gear,
      bytes: data.length,
      durationMs: Date.now() - started,
      errorClass: errorClass || classify(e),
    })
    throw e
  }
}

function classify(err: unknown): string {
  const msg = String((err as any)?.message || err || '').toLowerCase()
  if (/mtu|length|size|超过|too long/.test(msg)) return 'mtuFail'
  if (/disconnect|connect|未连接|断开/.test(msg)) return 'disconnect'
  return 'writeTimeout'
}
