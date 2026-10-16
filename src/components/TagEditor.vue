<script setup lang="ts">
import { ref, watch } from 'vue'
import { X, Plus } from 'lucide-vue-next'

export interface TagEditorValue {
  ocrText: string
  /** 标签列表（AI 识别 + 用户手动，全部中文） */
  tags: string[]
}

const props = defineProps<{
  modelValue: TagEditorValue
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: TagEditorValue): void
  /** 标签增删后立即上报，由父组件即时落库 */
  (e: 'saveTags', tags: string[]): void
  /** OCR 文字失焦时上报，由父组件即时落库 */
  (e: 'saveText', text: string): void
}>()

const newTag = ref('')

watch(
  () => props.modelValue,
  () => {
    newTag.value = ''
  },
  { deep: false }
)

function addTag() {
  const tag = newTag.value.trim()
  if (!tag || props.modelValue.tags.includes(tag)) {
    newTag.value = ''
    return
  }
  const nextTags = [...props.modelValue.tags, tag]
  emit('update:modelValue', {
    ...props.modelValue,
    tags: nextTags
  })
  newTag.value = ''
  emit('saveTags', nextTags)
}

function removeTag(tag: string) {
  const nextTags = props.modelValue.tags.filter((t) => t !== tag)
  emit('update:modelValue', {
    ...props.modelValue,
    tags: nextTags
  })
  emit('saveTags', nextTags)
}

function updateText(text: string) {
  emit('update:modelValue', { ...props.modelValue, ocrText: text })
}

function onTextBlur(text: string) {
  emit('saveText', text)
}
</script>

<template>
  <div class="space-y-5">
    <!-- 标签（AI 识别 + 用户手动，中文） -->
    <section>
      <h4 class="text-sm font-medium mb-2">标签</h4>
      <div class="flex flex-wrap gap-2 mb-2">
        <span v-for="tag in modelValue.tags" :key="tag" class="chip bg-black/5 text-ink">
          {{ tag }}
          <button
            type="button"
            class="cursor-pointer text-ink-faint hover:text-danger"
            aria-label="删除标签"
            @click="removeTag(tag)"
          >
            <X :size="12" />
          </button>
        </span>
        <span v-if="modelValue.tags.length === 0" class="text-xs text-ink-faint">
          暂无标签，AI 识别后会自动生成，也可手动添加
        </span>
      </div>
      <div class="flex gap-2">
        <input
          v-model="newTag"
          type="text"
          placeholder="添加标签"
          class="flex-1 h-10 rounded-xl bg-black/5 px-3 text-sm outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-ink-faint"
          @keyup.enter="addTag"
        />
        <button
          type="button"
          class="btn btn-ghost h-10 px-4 text-sm cursor-pointer"
          @click="addTag"
        >
          <Plus :size="15" />
          添加
        </button>
      </div>
      <p class="mt-1.5 text-xs text-ink-faint">
        AI 会自动识别情感与物体并生成标签，初判可能不准，可手动修正，修改后自动保存并参与搜索
      </p>
    </section>

    <!-- 图片文字 -->
    <section>
      <h4 class="text-sm font-medium mb-2">图片文字（OCR）</h4>
      <textarea
        :value="modelValue.ocrText"
        rows="3"
        placeholder="输入或修正表情包上的文字"
        class="w-full rounded-xl bg-black/5 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/40 resize-none placeholder:text-ink-faint"
        @input="updateText(($event.target as HTMLTextAreaElement).value)"
        @blur="onTextBlur(modelValue.ocrText)"
      />
    </section>
  </div>
</template>
