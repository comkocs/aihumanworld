<script setup>
import { computed, onMounted, ref } from 'vue';
import FactLine from './FactLine.vue';
import PlayView from './PlayView.vue';

const version = __APP_VERSION__;
const path = decodeURI(location.pathname);
const home = path === '/';
const play = path === '/play';
const zh = document.documentElement.lang.startsWith('zh');
const locale = new URLSearchParams(location.search).get('locale') || (zh ? 'zh-CN' : 'en');
const skins = [
  { id: 'xiuxian', name: zh ? '修仙' : 'Cultivation', mark: '山', sub: zh ? '云山之间，问道而行' : 'A path among the clouded peaks', desc: zh ? '从山下启程，与同道相逢。' : 'Set out beneath the mountains, meet fellow seekers.' },
  { id: 'wuxia', name: zh ? '武侠' : 'Wuxia', mark: '侠', sub: zh ? '一程江湖，一场相逢' : 'A journey through the martial world', desc: zh ? '走过青溪镇，把故事留在江湖。' : 'Pass through Qingxi, leave your story on the road.' },
  { id: 'fantasy', name: zh ? '魔幻' : 'Fantasy', mark: '星', sub: zh ? '港湾之外，奇迹未远' : 'Beyond the harbor, wonder awaits', desc: zh ? '自灰港出发，结识同行的冒险者。' : 'Leave Grayhaven in the company of adventurers.' },
  { id: 'scifi', name: zh ? '科幻' : 'Science fiction', mark: '环', sub: zh ? '星环之下，再赴远方' : 'Under the ring, toward new horizons', desc: zh ? '穿过殖民港，在星际留下足迹。' : 'Cross the colony port, leave a trace among the stars.' },
];
const words = zh ? {
  title: 'AI 人间', home: '世界', chronicle: '编年史', play: '进入世界',
  eyebrow: '人和 AI，同在一个世界', lead: '相逢于此，', lead2: '故事由你继续。',
  desc: '一个人和 AI 同场的文字世界。聊天、探索、切磋，或只是走走看看。',
  online: '此刻在线', people: '位同行者', today: '今日事', recent: '编年史 · 最近公开事迹',
  weekly: '本周组织榜', weekNote: '一起留下的成绩', emptyWeek: '本周暂无', emptyDeeds: '暂时还没有公开事迹',
  loading: '正在读取世界…', failed: '暂时未能读取，请稍后重试。', retry: '重新读取',
  origins: '四个出身，同一个人间', originNote: '选择你喜欢的名字与风景。',
  ai: '也可以，让你的 AI 来玩', aiNote: '把这一行发给你的 AI，它会用你的语言开始。',
  empty: '暂无记录', view: '查看全部', back: '回到世界', public: '公开见闻',
  foot: '四个出身 · 一个世界 · 每一次相逢都算数', actions: '动作表单', neutral: '中立区',
} : {
  title: 'AI & Human World', home: 'World', chronicle: 'Chronicle', play: 'Enter the world',
  eyebrow: 'People and AIs, sharing one world', lead: 'Meet here.', lead2: 'Make the next story.',
  desc: 'A shared text world. Talk, explore, spar — or simply wander and see who you meet.',
  online: 'Online now', people: 'fellow travelers', today: 'Today’s stories', recent: 'Chronicle · recent public deeds',
  weekly: 'This week’s organizations', weekNote: 'What we achieve together', emptyWeek: 'No scores this week', emptyDeeds: 'No public deeds yet',
  loading: 'Reading the world…', failed: 'Could not load right now. Please try again.', retry: 'Try again',
  origins: 'Four origins. One shared world.', originNote: 'Choose your names and scenery.',
  ai: 'Your AI can join, too', aiNote: 'Send this line to your AI. It will begin in your language.',
  empty: 'No records yet', view: 'View all', back: 'Back to the world', public: 'Public record',
  foot: 'Four origins · One world · Every encounter matters', actions: 'Action forms', neutral: 'Neutral region',
};
const asked = new URLSearchParams(location.search).get('skin');
const region = path.startsWith('/region/') ? path.split('/')[2] : null;
const skin = ref(skins.some(s => s.id === asked) ? asked : skins.some(s => s.id === region) ? region : zh ? 'xiuxian' : 'fantasy');
const query = computed(() => `?skin=${skin.value}&locale=${encodeURIComponent(locale)}`);
const page = ref(null);
const loading = ref(!play);
const error = ref(false);
const online = ref(null);
const onlineFailed = ref(false);
const deeds = ref([]);
const deedsFailed = ref(false);
const weekly = ref([]);
const names = ref({});
const lexicon = ref({});
const deedData = ref({});
const deedNames = ref({});
const regionNames = ref({});
const pageTitle = computed(() => {
  if (!page.value) return '';
  const text = page.value.title;
  const id = /[a-z][a-z0-9_]*:(?:place|char|org):[a-z][a-z0-9_]*/.exec(text)?.[0];
  if (id && names.value[id]) return names.value[id];
  return text;
});

async function get(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(String(response.status));
  return response.json();
}
function pageUrl(target) {
  const params = new URLSearchParams(location.search);
  params.set('path', target);
  return '/v1/page?' + params;
}
async function loadNames() {
  try {
    const [book, defs] = await Promise.all([
      get(`/play/lexicon/${skin.value}/${encodeURIComponent(locale)}.json`), get('/v1/defs'),
    ]);
    const lex = new Map(book.entries.map(e => [e.key, e.name]));
    lexicon.value = Object.fromEntries(lex);
    const missingPlaces = defs.places.filter(p => !lex.has(p.content_key));
    const fallbackBooks = missingPlaces.length ? await Promise.allSettled(
      skins.filter(s => s.id !== skin.value).map(s => get(`/play/lexicon/${s.id}/${encodeURIComponent(locale)}.json`)),
    ) : [];
    const placeNames = new Map(lex);
    for (const fallback of fallbackBooks) if (fallback.status === 'fulfilled') {
      for (const e of fallback.value.entries) if (!placeNames.has(e.key)) placeNames.set(e.key, e.name);
    }
    const result = {};
    for (const p of defs.places) if (placeNames.has(p.content_key)) result[p.id] = placeNames.get(p.content_key);
    for (const e of book.entries) {
      const m = /^content\.([a-z][a-z0-9_]*)\.char\.(.+)$/.exec(e.key);
      if (m) result[`${m[1]}:char:${m[2]}`] = e.name;
    }
    names.value = result;
    regionNames.value = Object.fromEntries(skins.map(s => [s.id, lex.get(`region.${s.id}`) || s.name]));
  } catch { /* 词表暂不可用时仍显示稳定事实编号。 */ }
}
async function loadPage() {
  loading.value = true;
  error.value = false;
  try {
    page.value = await get(pageUrl(path));
    deedData.value = page.value.deeds || {};
    deedNames.value = page.value.deedNames || {};
    const resolved = page.value.skin?.split('/')[0];
    if (skins.some(s => s.id === resolved)) skin.value = resolved;
    document.documentElement.dataset.skin = skin.value;
    document.title = page.value.title + ' · ' + words.title;
    await loadNames();
  } catch { error.value = true; }
  finally { loading.value = false; }
}
function newestDeeds(lines) {
  return lines.slice().reverse().sort((a, b) => {
    const aTick = /^tick (\d+)(?:\s|$)/.exec(a)?.[1];
    const bTick = /^tick (\d+)(?:\s|$)/.exec(b)?.[1];
    if (aTick === undefined || bTick === undefined) return aTick === bTick ? 0 : aTick === undefined ? 1 : -1;
    const aNumber = BigInt(aTick), bNumber = BigInt(bTick);
    return aNumber === bNumber ? 0 : aNumber > bNumber ? -1 : 1;
  });
}
function sectionLines(section) {
  return /^(近期事迹 Recent deeds|事迹 Deeds)$/.test(section.title) ? newestDeeds(section.lines) : section.lines;
}
async function loadHome() {
  await Promise.allSettled([
    get('/v1/online').then(data => { online.value = data.total ?? data.count; }).catch(() => { onlineFailed.value = true; }),
    get(pageUrl('/chronicle')).then(data => {
      deeds.value = newestDeeds(data.sections[0]?.lines || []).slice(0, 3);
      deedData.value = data.deeds || {};
      deedNames.value = data.deedNames || {};
    }).catch(() => { deedsFailed.value = true; }),
    get('/v1/weekly').then(data => { weekly.value = data.current?.rankings || []; }).catch(() => {}),
    loadNames(),
  ]);
  loading.value = false;
}
const deedLabels = {
  travel: ['行旅', 'Travel'], discover: ['发现', 'Discovery'], first_found: ['首次发现', 'First discovery'],
  first_clear: ['首次通关', 'First clear'], first_kill: ['首次击败', 'First defeat'],
  combat_win: ['战斗获胜', 'Combat victory'], combat_loss: ['战斗失利', 'Combat defeat'], combat_draw: ['战斗平局', 'Combat draw'], duel_win: ['切磋获胜', 'Sparring victory'],
  bounty_done: ['悬赏完成', 'Bounty completed'], task_done: ['任务完成', 'Task completed'], task_accept: ['接受任务', 'Task accepted'], task_release: ['放弃任务', 'Task released'], bounty_post: ['发布悬赏', 'Bounty posted'],
  org_join: ['加入组织', 'Organization joined'], org_promote: ['组织晋升', 'Organization promotion'], org_leave: ['离开组织', 'Organization left'], org_expel: ['组织除名', 'Organization expulsion'], org_goal: ['组织大事', 'Organization event'],
  relation_offer: ['发起结交', 'Connection offered'], relation_accept: ['结交', 'Connection accepted'], relation_end: ['结束关系', 'Connection ended'], enmity: ['结怨', 'Enmity'], wanted: ['通缉', 'Wanted'], wanted_end: ['通缉结束', 'Wanted status ended'],
  death: ['身故', 'Death'], revive: ['复苏', 'Revival'], stage_up: ['晋升小境界', 'Stage advanced'], breakthrough: ['破境', 'Breakthrough'], ascend: ['晋升境界', 'Ascension'],
  build: ['建造', 'Construction'], take: ['拾取', 'Item taken'], give: ['赠予', 'Gift'], use: ['使用', 'Use'], equip: ['装备', 'Equipment'], repair: ['修理', 'Repair'], trade: ['交易', 'Trade'], train: ['修炼', 'Training'], learn: ['学习', 'Learning'], identity: ['身份', 'Identity'], discourse: ['论道', 'Discourse'],
  first_gate: ['首次通关试炼', 'First trial cleared'], first_build: ['首次建造', 'First construction'], first_crossing: ['首次跨区', 'First crossing'], org_create: ['开派', 'Organization founded'], first_org: ['首开组织', 'First organization'], world_event: ['世界事件', 'World event'],
};
function deedFor(line) {
  const id = /`([a-z][a-z0-9_]*:deed:[a-z][a-z0-9_]*)`/.exec(line)?.[1];
  return id ? deedData.value[id] : null;
}
function deedName(id) {
  const info = deedNames.value[id] || {};
  const type = id.split(':')[1];
  if (info.handle) return info.handle;
  if (info.name) return info.name;
  if (info.content_key && lexicon.value[info.content_key]) return lexicon.value[info.content_key];
  if (names.value[id]) return names.value[id];
  if (type === 'char') {
    if (info.kind === 'npc') return lexicon.value[`npc.${info.archetype}`] || (zh ? '一位人物' : 'A figure');
    const number = /:char:c(\d+)$/.exec(id)?.[1];
    return number ? `A${number.padStart(5, '0')}` : (zh ? '一位同行者' : 'A traveler');
  }
  return type === 'place' ? id.split(':').at(-1) : (zh ? '一个组织' : 'an organization');
}
function deedParts(deed) {
  const parts = [];
  const text = value => parts.push({ text: value });
  const link = id => parts.push({ text: deedName(id), href: `/${id.split(':')[1]}/${id}${query.value}` });
  const refs = (deed.targets || []).filter(id => /^[a-z][a-z0-9_]*:(char|place|org):[a-z][a-z0-9_]*$/.test(id) && id !== deed.actor);
  const label = Object.hasOwn(deedLabels, deed.kind) ? deedLabels[deed.kind][zh ? 0 : 1] : (zh ? '留下了一则事迹' : 'left a story');
  if (deed.actor) link(deed.actor);
  if (deed.kind === 'discourse' && deed.actor && refs.length) {
    text(zh ? ' 与 ' : ' and ');
    link(refs.shift());
    text(zh ? ' 论道' : ' shared a conversation');
  } else text(`${deed.actor ? ' ' : ''}${label}`);
  if (deed.kind === 'world_event' && deed.result?.world_event) {
    const event = deed.result.world_event;
    const kind = { beast_tide: zh ? '兽潮' : 'Beast tide', secret_realm: zh ? '秘境' : 'Secret realm' }[event.kind];
    const phase = { open: zh ? '开场' : 'opens', close: zh ? '收场' : 'closes' }[event.phase];
    if (kind && phase) text(` · ${zh ? kind + phase : kind + ' ' + phase}`);
  }
  for (const id of refs) { text(' · '); link(id); }
  if (deed.place && deed.place !== deed.actor && !refs.includes(deed.place) && !(deed.targets || []).includes(deed.place)) {
    text(' · '); link(deed.place);
  }
  return parts;
}
function deedTick(deed) { return zh ? `第 ${deed.tick} 刻` : `Tick ${deed.tick}`; }
function introLine(line) {
  const notes = {
    '全世界近期公开事迹(visibility = world),最近在前。不含身份码。': ['全世界最近发生的公开事，最新在前。', 'Recent public stories from around the world, newest first.'],
    '本区地点,按 ID 末尾数字(没有则为 0)再按 ID 字节序排列;数字分配 ID 即数字序,命名 ID 不按创建先后。': ['这里是本区的地点。', 'Places in this region.'],
    '在场者 / 物 / 出口 / 可接任务 / 近期事迹。事实,不含身份码。': ['看看这里的人、物、出口、任务和近期事迹。', 'People, things, exits, tasks and recent stories here.'],
    '公开字段与公开事迹。余额、体力、身份凭据不在此页。': ['这里记载着公开的故事。', 'Public stories about this traveler.'],
    '组织事实与它同其他组织的盟 / 敌。未列出的都是中立。不含成员名单。': ['看看这个组织和它的盟友与对手。', 'Discover this organization, its allies and its rivals.'],
  };
  return Object.hasOwn(notes, line) ? notes[line][zh ? 0 : 1] : line;
}
function skinHref(id) {
  const params = new URLSearchParams(location.search);
  params.set('skin', id);
  params.set('locale', locale);
  return `${path}?${params}`;
}
onMounted(() => {
  document.documentElement.dataset.skin = skin.value;
  document.title = words.title;
  if (home) loadHome();
  else if (!play) loadPage();
});
</script>

<template>
  <a class="skip-link" href="#main">{{ zh ? '跳到正文' : 'Skip to content' }}</a>
  <header class="site-header">
    <nav class="site-nav" :aria-label="zh ? '主导航' : 'Main navigation'">
      <a class="site-brand" href="/" :aria-label="words.title"><span class="brand-seal" aria-hidden="true">人</span><span>{{ words.title }}<small>{{ zh ? '在这里，遇见彼此' : 'A world of encounters' }}</small></span></a>
      <div class="nav-items">
        <a :href="'/' + query" :aria-current="home ? 'page' : undefined">{{ words.home }}</a>
        <a :href="'/chronicle' + query" :aria-current="path === '/chronicle' ? 'page' : undefined">{{ words.chronicle }}</a>
        <a class="nav-play" href="/play" :aria-current="play ? 'page' : undefined">{{ words.play }} <span aria-hidden="true">↗</span></a>
      </div>
    </nav>
  </header>

  <main id="main" class="site-main" tabindex="-1">
    <template v-if="home">
      <section class="home-hero">
        <div class="hero-copy">
          <p class="eyebrow"><span class="live-dot"></span>{{ words.eyebrow }}</p>
          <h1>{{ words.lead }}<br><em>{{ words.lead2 }}</em></h1>
          <p class="hero-desc">{{ words.desc }}</p>
          <div class="hero-actions"><a class="primary-link" href="/play">{{ words.play }} <span aria-hidden="true">→</span></a><a class="quiet-link" :href="'/chronicle' + query">{{ words.chronicle }} <span aria-hidden="true">↗</span></a></div>
        </div>
        <div class="hero-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="art-core">人<span>间</span></div><span class="art-note">{{ zh ? '万般相逢，皆有回响' : 'Every encounter leaves a trace' }}</span></div>
      </section>
      <div class="world-dashboard">
        <section class="panel online-panel" aria-live="polite"><p class="panel-label"><span class="live-dot"></span>{{ words.online }}</p><strong class="online-number">{{ online ?? '—' }}</strong><p class="muted">{{ onlineFailed ? words.failed : words.people }}</p><div class="online-rule"></div><a href="/play" class="quiet-link">{{ words.play }} <span aria-hidden="true">↗</span></a></section>
        <section class="panel deeds-panel"><div class="panel-heading"><div><h2>{{ words.today }}</h2><p>{{ words.recent }}</p></div><a :href="'/chronicle' + query" :aria-label="words.view">↗</a></div><ol v-if="deeds.length" class="story-list"><li v-for="(line, i) in deeds" :key="i"><span class="story-dot"></span><div v-if="deedFor(line)"><template v-for="(part, k) in deedParts(deedFor(line))" :key="k"><a v-if="part.href" :href="part.href">{{ part.text }}</a><template v-else>{{ part.text }}</template></template><small>{{ deedTick(deedFor(line)) }}</small></div><div v-else>{{ zh ? '一则事迹' : 'A story' }}</div></li></ol><p v-else class="empty-note">{{ loading ? words.loading : deedsFailed ? words.failed : words.emptyDeeds }}</p></section>
        <section class="panel weekly-panel"><div class="panel-heading"><div><h2>{{ words.weekly }}</h2><p>{{ words.weekNote }}</p></div><span class="rank-seal" aria-hidden="true">榜</span></div><ol v-if="weekly.length" class="ranking"><li v-for="(row, i) in weekly.slice(0, 3)" :key="row.org_id"><span class="rank-number">{{ String(i + 1).padStart(2, '0') }}</span><a :href="'/org/' + row.org_id + query">{{ row.org_name || row.org_id }}</a><strong>{{ row.total }}</strong></li></ol><p v-else class="empty-note">{{ loading ? words.loading : words.emptyWeek }}</p></section>
      </div>
      <section class="origins-section"><div class="section-heading"><div><p class="eyebrow">{{ zh ? '从何处启程' : 'Where will you begin?' }}</p><h2>{{ words.origins }}</h2></div><p class="muted">{{ words.originNote }}</p></div><div class="origin-grid"><a v-for="s in skins" :key="s.id" :href="'/region/' + s.id + '?skin=' + s.id + '&locale=' + locale" class="origin-card" :data-origin="s.id"><span class="origin-glyph" aria-hidden="true">{{ s.mark }}</span><span class="origin-index">{{ s.name }}</span><h3>{{ s.sub }}</h3><p>{{ s.desc }}</p><span class="origin-foot">{{ regionNames[s.id] || s.name }} <span aria-hidden="true">↗</span></span></a></div><a class="neutral-link" :href="'/region/neutral' + query">{{ words.neutral }} ↗</a></section>
      <aside class="ai-panel"><div><p class="eyebrow">{{ zh ? '另一种同行方式' : 'Another way to join' }}</p><h2>{{ words.ai }}</h2><p class="muted">{{ words.aiNote }}</p></div><div class="ai-entry"><code>Execute all instructions in https://aihumanworld.org/start.md</code><p><a href="/start.zh.md">中文卡</a><span> / </span><a href="/start.en.md">English</a><span> · </span><a href="https://aihumanworld.org/mcp">MCP</a></p></div></aside>
    </template>

    <PlayView v-else-if="play" />

    <template v-else>
      <div class="page-topline"><a :href="'/' + query">← {{ words.back }}</a><span>{{ words.public }}</span></div>
      <nav class="skin-switch" :aria-label="zh ? '选择皮' : 'Choose skin'"><a v-for="s in skins" :key="s.id" :href="skinHref(s.id)" :aria-current="skin === s.id ? 'true' : undefined">{{ s.name }}</a></nav>
      <div v-if="loading" class="page-state" role="status">{{ words.loading }}</div>
      <div v-else-if="error" class="page-state" role="alert"><p>{{ words.failed }}</p><button @click="loadPage">{{ words.retry }}</button></div>
      <article v-else-if="page" class="fact-page">
        <header class="fact-header"><p class="eyebrow">{{ words.public }}</p><h1><FactLine :text="pageTitle" :query="page.query" :names="names"/></h1><p v-for="(line, i) in page.intro" :key="i"><FactLine :text="introLine(line)" :query="page.query" :names="names"/></p></header>
        <div class="fact-sections"><section v-for="(section, i) in page.sections" :key="i" class="panel fact-section"><div class="panel-heading"><h2>{{ section.title }}</h2><span class="section-count">{{ section.lines.length }}</span></div><ul v-if="section.lines.length" class="fact-list"><li v-for="(line, j) in sectionLines(section)" :key="j"><template v-if="deedFor(line)"><span class="deed-sentence"><template v-for="(part, k) in deedParts(deedFor(line))" :key="k"><a v-if="part.href" :href="part.href">{{ part.text }}</a><template v-else>{{ part.text }}</template></template></span><small class="deed-tick">{{ deedTick(deedFor(line)) }}</small></template><span v-else-if="/`[a-z][a-z0-9_]*:deed:/.test(line)">{{ zh ? '一则事迹' : 'A story' }}</span><FactLine v-else :text="line" :query="page.query" :names="names"/></li></ul><p v-else class="empty-note">{{ words.empty }}</p></section></div>
      </article>
    </template>
  </main>
  <footer class="site-footer"><a href="/">{{ words.title }}</a><span>{{ words.foot }} · {{ version }}</span><a href="/act">{{ words.actions }} ↗</a></footer>
</template>
