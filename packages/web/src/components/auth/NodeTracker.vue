<script setup lang="ts">
import { computed } from 'vue';
import type { LoginClipboardNode, NodeProjection } from './types';

interface VisibleNode {
  node: LoginClipboardNode;
  projection: NodeProjection;
}

const props = withDefaults(
  defineProps<{
    nodes: LoginClipboardNode[];
    projections: NodeProjection[];
  }>(),
  {
    nodes: () => [],
    projections: () => []
  }
);

const emit = defineEmits<{
  (e: 'select', value: LoginClipboardNode): void;
}>();

const projectionMap = computed(() => {
  return new Map(props.projections.map((entry) => [entry.id, entry]));
});

const visibleNodes = computed<VisibleNode[]>(() => {
  return props.nodes
    .map((node) => {
      const projection = projectionMap.value.get(node.id);
      return projection && projection.visible ? { node, projection } : null;
    })
    .filter((entry): entry is VisibleNode => Boolean(entry));
});

const trackerLines = computed(() => {
  if (visibleNodes.value.length < 2) {
    return [] as Array<{ key: string; from: VisibleNode; to: VisibleNode; active: boolean }>;
  }

  const lines: Array<{ key: string; from: VisibleNode; to: VisibleNode; active: boolean }> = [];
  for (let index = 0; index < visibleNodes.value.length - 1; index += 1) {
    lines.push({
      key: `line-${visibleNodes.value[index].node.id}-${visibleNodes.value[index + 1].node.id}`,
      from: visibleNodes.value[index],
      to: visibleNodes.value[index + 1],
      active: index === 0
    });
  }

  if (visibleNodes.value.length >= 3) {
    lines.push({
      key: `line-${visibleNodes.value[visibleNodes.value.length - 1].node.id}-${visibleNodes.value[0].node.id}`,
      from: visibleNodes.value[visibleNodes.value.length - 1],
      to: visibleNodes.value[0],
      active: false
    });
  }

  return lines;
});

function handleNodeSelect(node: LoginClipboardNode) {
  emit('select', node);
}
</script>

<template>
  <div class="node-tracker-layer">
    <svg class="tracker-lines">
      <line
        v-for="line in trackerLines"
        :key="line.key"
        :x1="line.from.projection.x"
        :y1="line.from.projection.y"
        :x2="line.to.projection.x"
        :y2="line.to.projection.y"
        :class="line.active ? 'svg-line active' : 'svg-line'"
      />
    </svg>

    <div class="trackers-container">
      <div
        v-for="entry in visibleNodes"
        :key="entry.node.id"
        class="point-marker"
        :style="{ transform: `translate(${entry.projection.x}px, ${entry.projection.y}px)` }"
      >
        <div class="point-dot" />
        <div class="point-corner pc-tl" />
        <div class="point-corner pc-br" />
        <button class="point-label" type="button" @click="handleNodeSelect(entry.node)">
          <span class="label-icon">★</span>
          <span>{{ entry.node.nodeLabel }}</span>
          <span class="speed-badge">[速度{{ entry.node.speedLevel }}]</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.node-tracker-layer {
  position: absolute;
  inset: 0;
  z-index: 8;
  pointer-events: none;
}

.tracker-lines {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.svg-line {
  stroke: rgba(255, 255, 255, 0.12);
  stroke-width: 1;
}

.svg-line.active {
  stroke: rgba(255, 255, 255, 0.45);
  stroke-dasharray: 3 5;
  animation: dash 15s linear infinite;
}

.trackers-container {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.point-marker {
  position: absolute;
  width: 0;
  height: 0;
  pointer-events: none;
}

.point-dot {
  position: absolute;
  width: 3px;
  height: 3px;
  border-radius: 999px;
  background: #fff;
  transform: translate(-50%, -50%);
  box-shadow: 0 0 4px rgba(255, 255, 255, 0.85);
}

.point-label {
  position: absolute;
  top: 10px;
  left: 10px;
  border: 0;
  border-radius: 2px;
  padding: 2px 6px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(255, 255, 255, 0.92);
  color: #111827;
  font-family: 'SF Mono', SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 9px;
  line-height: 1;
  letter-spacing: 0.04em;
  white-space: nowrap;
  cursor: pointer;
  pointer-events: auto;
  transition: all 0.18s ease;
}

.point-label:hover {
  background: rgba(255, 255, 255, 0.98);
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.22);
}

.label-icon {
  font-size: 8px;
}

.speed-badge {
  color: #6b7280;
  font-size: 8px;
}

.point-corner {
  position: absolute;
  width: 8px;
  height: 8px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  transform: translate(-50%, -50%);
}

.pc-tl {
  border-width: 1px 0 0 1px;
  top: -3px;
  left: -3px;
}

.pc-br {
  border-width: 0 1px 1px 0;
  bottom: -3px;
  right: -3px;
}

@keyframes dash {
  to {
    stroke-dashoffset: -100;
  }
}
</style>
