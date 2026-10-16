/**
 * 图片加载并发队列。
 *
 * 网格里可能有成百上千张表情，若每张卡片挂载就立刻解析图源（content:// 需经
 * 原生拷贝为 file://）并让 WebView 解码，会瞬间打出大量请求 + 原生 IO，
 * 造成滚动卡死、内存飙升。这里用一个全局队列限制「同时进行的图源解析」数量，
 * 让加载按进入视口的顺序排队执行。
 *
 * 说明：本队列只限制「URL 解析」这一步（原生拷贝 / fetch），
 * 真正的解码由 <img> 自身按需完成。
 */

/** 并发上限：兼顾加载速度与主线程/原生 IO 压力 */
const MAX_CONCURRENT = 4

let active = 0
/** 等待执行的任务（FIFO：按卡片进入视口的自然顺序） */
const waiting: Array<() => void> = []

function pump(): void {
  while (active < MAX_CONCURRENT && waiting.length > 0) {
    const next = waiting.shift()
    next?.()
  }
}

/**
 * 将图源解析任务加入队列。
 * @param task 真正执行的解析逻辑
 * @param isAlive 可选的存活判定；返回 false 时任务被直接丢弃（卡片已卸载/已滚远），
 *                不再浪费一次原生 IO，返回 undefined 由调用方自行忽略。
 */
export function enqueueLoad<T>(
  task: () => Promise<T>,
  isAlive?: () => boolean
): Promise<T | undefined> {
  return new Promise<T | undefined>((resolve, reject) => {
    const run = () => {
      if (isAlive && !isAlive()) {
        resolve(undefined)
        pump()
        return
      }
      active++
      task()
        .then(resolve, reject)
        .finally(() => {
          active--
          // 让出一次微任务后再补位，避免同步递归过深
          Promise.resolve().then(pump)
        })
    }
    waiting.push(run)
    pump()
  })
}
