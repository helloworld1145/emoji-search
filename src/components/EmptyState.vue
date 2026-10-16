<script setup lang="ts">
defineProps<{
  icon?: string
  title: string
  description?: string
  actionText?: string
}>()

const emit = defineEmits<{
  (e: 'action'): void
}>()
</script>

<template>
  <div class="flex flex-col items-center justify-center py-16 px-8 text-center">
    <div class="text-5xl mb-4">{{ icon ?? '🎈' }}</div>
    <h3 class="text-base font-semibold">{{ title }}</h3>
    <p v-if="description" class="mt-1.5 text-sm text-ink-muted leading-relaxed">
      {{ description }}
    </p>
    <button
      v-if="actionText"
      type="button"
      class="btn btn-primary mt-6 px-6 h-10 text-sm cursor-pointer"
      @click="emit('action')"
    >
      {{ actionText }}
    </button>
  </div>
</template>
