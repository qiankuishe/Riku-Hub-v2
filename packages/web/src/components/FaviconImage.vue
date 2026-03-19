<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type ComponentPublicInstance } from 'vue';
import { faviconApi } from '../api';
import { getFavicon as getCachedFavicon, setFavicon as cacheFavicon } from '../utils/faviconCache';

const props = withDefaults(
  defineProps<{
    url: string;
    title: string;
    className?: string;
  }>(),
  {
    className: 'favicon-image'
  }
);

const sourceIndex = ref(0);
const showLetter = ref(false);
const cachedDataUrl = ref<string | null>(null);
const cacheChecked = ref(false);
const shouldLoad = ref(false);
const rootElement = ref<HTMLElement | null>(null);
let visibilityObserver: IntersectionObserver | null = null;

const faviconSources = [
  (domain: string) => `https://www.google.com/s2/favicons?sz=64&domain=${domain}`,
  (domain: string) =>
    `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=64`,
  (domain: string) => `https://${domain}/favicon.ico`
];

const domain = computed(() => {
  try {
    return new URL(props.url).hostname;
  } catch {
    return '';
  }
});

const imageSource = computed(() => {
  if (!domain.value) {
    return '';
  }
  const factory = faviconSources[sourceIndex.value] ?? faviconSources[0];
  return factory(domain.value);
});

function resetState() {
  sourceIndex.value = 0;
  showLetter.value = false;
  cachedDataUrl.value = null;
  cacheChecked.value = false;
}

function setRootElement(element: Element | ComponentPublicInstance | null) {
  rootElement.value = element instanceof HTMLElement ? element : null;
}

function markVisible() {
  if (shouldLoad.value) {
    return;
  }

  shouldLoad.value = true;
  visibilityObserver?.disconnect();
  visibilityObserver = null;
}

function observeVisibility() {
  if (typeof window === 'undefined') {
    return;
  }

  if (shouldLoad.value) {
    return;
  }

  if (!('IntersectionObserver' in window)) {
    markVisible();
    return;
  }

  if (!rootElement.value) {
    return;
  }

  visibilityObserver?.disconnect();
  visibilityObserver = new window.IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) {
        markVisible();
      }
    },
    {
      rootMargin: '240px 0px'
    }
  );
  visibilityObserver.observe(rootElement.value);
}

function tryNextSource() {
  const next = sourceIndex.value + 1;
  if (next < faviconSources.length) {
    sourceIndex.value = next;
    return;
  }
  showLetter.value = true;
}

async function loadCache() {
  if (!shouldLoad.value) {
    return;
  }

  if (!domain.value) {
    cacheChecked.value = true;
    return;
  }

  const cached = await getCachedFavicon(props.url);
  if (cached) {
    cachedDataUrl.value = cached;
    cacheChecked.value = true;
    return;
  }

  try {
    const remote = await faviconApi.get(props.url);
    cachedDataUrl.value = remote.dataUrl;
    await cacheFavicon(props.url, remote.dataUrl);
  } catch {
    cachedDataUrl.value = null;
  }
  cacheChecked.value = true;
}

async function handleLoad(event: Event) {
  const image = event.target as HTMLImageElement;
  if (image.naturalWidth <= 16 || image.naturalHeight <= 16) {
    tryNextSource();
    return;
  }

  if (cachedDataUrl.value || image.src.startsWith('data:')) {
    return;
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    context.drawImage(image, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    await cacheFavicon(props.url, dataUrl);
  } catch {
    // ignore cross-origin canvas failures
  }
}

watch(
  () => props.url,
  () => {
    resetState();
    if (shouldLoad.value) {
      void loadCache();
    }
  }
);

watch(rootElement, () => {
  observeVisibility();
});

watch(shouldLoad, (visible) => {
  if (visible) {
    void loadCache();
  }
});

onMounted(() => {
  observeVisibility();
});

onBeforeUnmount(() => {
  visibilityObserver?.disconnect();
  visibilityObserver = null;
});
</script>

<template>
  <div v-if="showLetter || !domain" :ref="setRootElement" class="favicon-fallback" :class="className">
    <span>{{ title[0]?.toUpperCase() || '?' }}</span>
  </div>
  <img
    v-else-if="cachedDataUrl"
    :ref="setRootElement"
    :src="cachedDataUrl"
    alt=""
    :class="className"
    loading="lazy"
    decoding="async"
  />
  <div v-else-if="!cacheChecked || !shouldLoad" :ref="setRootElement" class="favicon-skeleton" :class="className"></div>
  <img
    v-else
    :ref="setRootElement"
    :src="imageSource"
    alt=""
    :class="className"
    loading="lazy"
    decoding="async"
    @error="tryNextSource"
    @load="handleLoad"
  />
</template>
