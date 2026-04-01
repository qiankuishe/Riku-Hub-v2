<script setup lang="ts">
defineProps<{
  title: string;
  subtitle: string;
}>();
</script>

<template>
  <header class="topbar" v-show="false">
    <div class="topbar-title">
    </div>
  </header>
</template>
