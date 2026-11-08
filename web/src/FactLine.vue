<script setup>
import { computed } from 'vue';
const props = defineProps({ text: { type: String, default: '' }, query: { type: String, default: '' }, names: { type: Object, default: () => ({}) } });
const parts = computed(() => {
  const parts = [];
  const re = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let end = 0;
  for (const match of props.text.matchAll(re)) {
    if (match.index > end) parts.push({ text: props.text.slice(end, match.index) });
    const id = match[1];
    if (id) {
      const fact = /^[a-z][a-z0-9_]*:(place|char|org):[a-z][a-z0-9_]*$/.exec(id);
      if (fact) parts.push({ text: props.names[id] || id, href: `/${fact[1]}/${id}${props.query}` });
      else if (!/^(?:[a-z_]+\.|tier\d|stage\d|grade\d)/.test(id)) parts.push({ text: id, code: true });
    } else {
      const href = match[3];
      parts.push({ text: match[2], ...(href.startsWith('/') && !href.startsWith('//') ? { href } : {}) });
    }
    end = match.index + match[0].length;
  }
  if (end < props.text.length) parts.push({ text: props.text.slice(end) });
  return parts;
});
</script>

<template>
  <template v-for="(part, i) in parts" :key="i">
    <a v-if="part.href" :href="part.href">{{ part.text }}</a>
    <code v-else-if="part.code">{{ part.text }}</code>
    <template v-else>{{ part.text }}</template>
  </template>
</template>
