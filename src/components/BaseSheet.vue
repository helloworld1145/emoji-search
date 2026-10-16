<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import { pushBackHandler } from '../services/backHandler'

const props = defineProps<{
  visible: boolean
  title?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

// 弹层可见时注册返回键拦截：系统返回/手势返回 = 关闭弹层，而非回退页面
let unregisterBack: (() => void) | null = null

function syncBackHandler(visible: boolean) {
  unregisterBack?.()
  unregisterBack = visible
    ? pushBackHandler(() => {
        emit('close')
        return true
      })
    : null
}

watch(() => props.visible, syncBackHandler, { immediate: true })
onUnmounted(() => {
  unregisterBack?.()
  unregisterBack = null
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <teleport to="body">
    <transition name="sheet">
      <div v-if="visible" class="fixed inset-0 z-50 flex flex-col justify-end">
        <div
          class="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
          @click="emit('close')"
        />
        <section
          class="relative bg-card rounded-t-sheet shadow-float max-h-[75vh] flex flex-col animate-fade-up"
        >
          <header class="flex items-center justify-between px-5 pt-4 pb-2">
            <h3 class="text-base font-semibold">{{ title ?? '' }}</h3>
            <button
              type="button"
              class="btn btn-ghost w-8 h-8 !p-0 cursor-pointer"
              aria-label="关闭"
              @click="emit('close')"
            >
              ✕
            </button>
          </header>
          <div class="px-5 pb-[calc(20px+env(safe-area-inset-bottom))] overflow-y-auto">
            <slot />
          </div>
        </section>
      </div>
    </transition>
  </teleport>
</template>

<style scoped>
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.22s ease;
}
.sheet-enter-active section,
.sheet-leave-active section {
  transition: transform 0.28s cubic-bezier(0.32, 0.72, 0, 1);
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from section,
.sheet-leave-to section {
  transform: translateY(30%);
}
</style>
