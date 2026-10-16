<script setup lang="ts">
import { computed } from 'vue'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-vue-next'
import type { ScanProgress } from '../types'

const props = defineProps<{
  state: ScanProgress
}>()

const percent = computed(() => {
  if (props.state.total <= 0) return 0
  return Math.min(100, Math.round((props.state.processed / props.state.total) * 100))
})

const visible = computed(() =>
  ['scanning', 'recognizing'].includes(props.state.phase)
)
</script>

<template>
  <div
    v-if="visible"
    class="mx-4 mb-3 card p-3 flex items-center gap-3 animate-fade-up"
    role="status"
  >
    <Loader2 :size="20" class="text-primary animate-spin shrink-0" />
    <div class="flex-1 min-w-0">
      <div class="flex items-center justify-between text-xs text-ink-muted">
        <span>{{ state.message ?? (state.phase === 'recognizing' ? 'AI 识别中' : '扫描中') }}</span>
        <span>{{ percent }}%</span>
      </div>
      <div class="mt-1.5 h-1.5 rounded-full bg-black/5 overflow-hidden">
        <div
          class="h-full rounded-full bg-gradient-to-r from-primary to-secondary transition-all duration-300"
          :style="{ width: percent + '%' }"
        />
      </div>
    </div>
    <span class="text-xs text-ink-faint shrink-0">
      {{ state.processed }}/{{ state.total }}
    </span>
  </div>
  <div
    v-else-if="state.phase === 'done'"
    class="mx-4 mb-3 card p-3 flex items-center gap-2.5 text-sm text-success animate-fade-up"
  >
    <CheckCircle2 :size="18" />
    <span>扫描完成，共 {{ state.total }} 张表情</span>
  </div>
  <div
    v-else-if="state.phase === 'error'"
    class="mx-4 mb-3 card p-3 flex items-start gap-2.5 text-sm text-danger animate-fade-up"
    role="alert"
  >
    <AlertCircle :size="18" class="shrink-0 mt-0.5" />
    <span class="min-w-0 break-words">{{ state.message ?? '操作失败，请重试' }}</span>
  </div>
</template>
