<script setup>
import { onMounted, ref } from 'vue';
const failed = ref(false);
onMounted(() => {
  // 原脚本独占这组固定 DOM，Vue 不再更新其中的子节点。
  const script = document.createElement('script');
  script.src = '/play/static/play.js';
  script.onerror = () => { failed.value = true; };
  document.body.appendChild(script);
});
</script>

<template>
  <section class="play-surface" aria-label="游戏">
    <p v-if="failed" role="alert">游戏脚本未能载入，请刷新重试。</p>
    <div v-once>
      <div id="gate"></div>
      <div id="reveal" class="hidden"></div>
      <main id="world" class="hidden">
        <header id="world-head" class="top"></header>
        <p id="status" class="small" role="status"></p>
        <div id="world-view" class="grid"></div>
        <section id="events-card" class="card">
          <h3 id="events-title"></h3>
          <div id="events" class="list"></div>
        </section>
        <details class="raw"><summary id="details-title"></summary><pre id="last-raw"></pre></details>
      </main>
      <div id="toast" class="toast hidden" role="status"></div>
    </div>
  </section>
</template>
