// 由 src/data/changelog.json 生成根目录 CHANGELOG.md（Keep a Changelog 规范，中文分类）
// 用法：node scripts/gen-changelog.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const jsonPath = resolve(root, 'src/data/changelog.json')
const outPath = resolve(root, 'CHANGELOG.md')

const data = JSON.parse(readFileSync(jsonPath, 'utf-8'))

const CATEGORY_LABELS = { added: '新增', changed: '优化', fixed: '修复' }
const CATEGORY_ORDER = ['added', 'changed', 'fixed']

// 数据源按时间升序存储，文档按「最新在上」倒序展示
const entries = [...data].reverse()

function renderEntry(entry) {
  const lines = [`## [${entry.version}] - ${entry.date}`, '']
  let hasSection = false
  for (const key of CATEGORY_ORDER) {
    const items = entry.changes?.[key]
    if (Array.isArray(items) && items.length > 0) {
      hasSection = true
      lines.push(`### ${CATEGORY_LABELS[key]}`, '')
      for (const it of items) lines.push(`- ${it}`)
      lines.push('')
    }
  }
  if (!hasSection) lines.push('_本版本无记录_', '')
  return lines.join('\n')
}

const header = [
  '# 更新日志',
  '',
  '> 本文件由脚本自动生成，请勿直接手工编辑。',
  '> 更新版本时请修改 `src/data/changelog.json`（在数组**最前面**插入新版本），然后运行 `node scripts/gen-changelog.mjs` 重新生成本文件。',
  '',
  '所有更新均完全离线、不联网、不上传图片。',
  ''
].join('\n')

const body = entries.map(renderEntry).join('\n')

writeFileSync(outPath, header + body, 'utf-8')
console.log(`CHANGELOG.md 已生成，共 ${entries.length} 个版本。`)
