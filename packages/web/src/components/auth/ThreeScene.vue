<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import type { NodeProjection, SceneNode } from './types';

declare global {
  interface Window {
    THREE?: any;
  }
}

interface MotionState {
  orbitRadius: number;
  orbitSpeed: number;
  orbitPhase: number;
  waveAmplitude: number;
  waveFrequency: number;
  wavePhaseX: number;
  wavePhaseY: number;
  wavePhaseZ: number;
  spiralSpeed: number;
  spiralRadius: number;
  driftSpeed: number;
  driftX: number;
  driftY: number;
  driftZ: number;
}

const props = withDefaults(
  defineProps<{
    nodes: SceneNode[];
  }>(),
  {
    nodes: () => []
  }
);

const emit = defineEmits<{
  (e: 'project', value: NodeProjection[]): void;
  (e: 'error', message: string): void;
}>();

const containerRef = ref<HTMLDivElement | null>(null);

let three: any = null;
let scene: any = null;
let camera: any = null;
let renderer: any = null;
let mainGroup: any = null;
let particleMesh: any = null;
let rafId = 0;
let width = 0;
let height = 0;

const speedSettings: Record<number, { x: number; y: number }> = {
  1: { y: 0.0002, x: 0.0001 },
  2: { y: 0.0006, x: 0.0003 },
  3: { y: 0.001, x: 0.0005 },
  4: { y: 0.0014, x: 0.0007 },
  5: { y: 0.0028, x: 0.0014 }
};

const motionByNodeId = new Map<string, MotionState>();

function hashSeed(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash) + 1;
}

function createRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

function createMotion(nodeId: string): MotionState {
  const random = createRandom(hashSeed(nodeId));
  return {
    orbitRadius: random() * 1.5 + 0.5,
    orbitSpeed: random() * 0.003 + 0.002,
    orbitPhase: random() * Math.PI * 2,
    waveAmplitude: random() * 0.8 + 0.4,
    waveFrequency: random() * 0.004 + 0.002,
    wavePhaseX: random() * Math.PI * 2,
    wavePhaseY: random() * Math.PI * 2,
    wavePhaseZ: random() * Math.PI * 2,
    spiralSpeed: random() * 0.002 + 0.001,
    spiralRadius: random() * 0.6 + 0.3,
    driftSpeed: random() * 0.0015 + 0.0005,
    driftX: (random() - 0.5) * 2,
    driftY: (random() - 0.5) * 2,
    driftZ: (random() - 0.5) * 2
  };
}

function ensureMotionState(node: SceneNode): MotionState | null {
  if (node.speedLevel !== 5) {
    return null;
  }
  const existing = motionByNodeId.get(node.id);
  if (existing) {
    return existing;
  }
  const created = createMotion(node.id);
  motionByNodeId.set(node.id, created);
  return created;
}

function pruneMotionState() {
  const nodeIds = new Set(props.nodes.map((node) => node.id));
  for (const key of motionByNodeId.keys()) {
    if (!nodeIds.has(key)) {
      motionByNodeId.delete(key);
    }
  }
}

function getContainerSize() {
  const rect = containerRef.value?.getBoundingClientRect();
  width = Math.max(1, Math.floor(rect?.width ?? window.innerWidth));
  height = Math.max(1, Math.floor(rect?.height ?? window.innerHeight));
}

function applyResponsiveOffset() {
  if (!mainGroup) {
    return;
  }
  mainGroup.position.x = width < 768 ? 0 : 4.5;
}

function handleResize() {
  if (!renderer || !camera) {
    return;
  }
  getContainerSize();
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  applyResponsiveOffset();
}

function buildProjectionList(timeMs: number): NodeProjection[] {
  if (!three || !particleMesh || !mainGroup || !camera) {
    return [];
  }

  const time = timeMs * 0.001;
  return props.nodes.map((node) => {
    const position = new three.Vector3(node.basePosition.x, node.basePosition.y, node.basePosition.z);
    const motion = ensureMotionState(node);

    if (motion) {
      const orbitAngle = time * motion.orbitSpeed + motion.orbitPhase;
      const orbitX = Math.cos(orbitAngle) * motion.orbitRadius;
      const orbitY = Math.sin(orbitAngle) * motion.orbitRadius;

      const waveX = Math.sin(time * motion.waveFrequency + motion.wavePhaseX) * motion.waveAmplitude;
      const waveY = Math.cos(time * motion.waveFrequency + motion.wavePhaseY) * motion.waveAmplitude;
      const waveZ = Math.sin(time * motion.waveFrequency * 0.7 + motion.wavePhaseZ) * motion.waveAmplitude * 0.5;

      const spiralAngle = time * motion.spiralSpeed;
      const spiralX = Math.cos(spiralAngle) * motion.spiralRadius * Math.sin(time * 0.001);
      const spiralY = Math.sin(spiralAngle) * motion.spiralRadius * Math.cos(time * 0.001);

      const driftX = Math.sin(time * motion.driftSpeed) * motion.driftX;
      const driftY = Math.cos(time * motion.driftSpeed * 1.3) * motion.driftY;
      const driftZ = Math.sin(time * motion.driftSpeed * 0.8) * motion.driftZ;

      position.x += orbitX + waveX + spiralX + driftX;
      position.y += orbitY + waveY + spiralY + driftY;
      position.z += waveZ + driftZ;
    }

    const projected = position
      .applyEuler(particleMesh.rotation)
      .applyMatrix4(particleMesh.matrix)
      .applyMatrix4(mainGroup.matrixWorld)
      .project(camera);

    const x = (projected.x * 0.5 + 0.5) * width;
    const y = (-(projected.y * 0.5) + 0.5) * height;
    const visible = projected.z > -1 && projected.z < 1;

    return {
      id: node.id,
      label: node.label,
      x,
      y,
      visible
    };
  });
}

function animate(time: number) {
  rafId = window.requestAnimationFrame(animate);
  if (!renderer || !scene || !particleMesh) {
    return;
  }

  const medium = speedSettings[3];
  particleMesh.rotation.y += medium.y;
  particleMesh.rotation.x += medium.x;

  // 更新shader的时间uniform，驱动粒子闪烁
  if (particleMesh.material.uniforms) {
    particleMesh.material.uniforms.time.value = time;
  }

  emit('project', buildProjectionList(time));
  renderer.render(scene, camera);
}

function destroyScene() {
  if (rafId) {
    window.cancelAnimationFrame(rafId);
    rafId = 0;
  }

  window.removeEventListener('resize', handleResize);

  if (particleMesh?.geometry) {
    particleMesh.geometry.dispose();
  }
  if (particleMesh?.material?.dispose) {
    particleMesh.material.dispose();
  }
  if (renderer?.dispose) {
    renderer.dispose();
  }

  if (containerRef.value && renderer?.domElement && containerRef.value.contains(renderer.domElement)) {
    containerRef.value.removeChild(renderer.domElement);
  }

  scene = null;
  camera = null;
  renderer = null;
  mainGroup = null;
  particleMesh = null;
}

async function ensureThree() {
  if (window.THREE) {
    return window.THREE;
  }

  const scriptId = 'rk-three-r128-script';
  const existing = document.getElementById(scriptId) as HTMLScriptElement | null;
  if (existing) {
    await new Promise<void>((resolve, reject) => {
      if (window.THREE) {
        resolve();
        return;
      }
      const onLoad = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('Three.js 脚本加载失败'));
      };
      const cleanup = () => {
        existing.removeEventListener('load', onLoad);
        existing.removeEventListener('error', onError);
      };
      existing.addEventListener('load', onLoad);
      existing.addEventListener('error', onError);
    });
    if (!window.THREE) {
      throw new Error('Three.js 初始化失败');
    }
    return window.THREE;
  }

  const script = document.createElement('script');
  script.id = scriptId;
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  script.async = true;
  document.head.appendChild(script);

  await new Promise<void>((resolve, reject) => {
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Three.js 脚本加载失败'));
  });

  if (!window.THREE) {
    throw new Error('Three.js 初始化失败');
  }
  return window.THREE;
}

function initScene() {
  if (!containerRef.value || !three) {
    return;
  }

  getContainerSize();

  scene = new three.Scene();
  scene.background = new three.Color(0x000000);

  camera = new three.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.z = 21;

  renderer = new three.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height);
  containerRef.value.appendChild(renderer.domElement);

  mainGroup = new three.Group();
  scene.add(mainGroup);
  applyResponsiveOffset();

  const geometry = new three.SphereGeometry(5.8, 64, 64);
  const positions = geometry.attributes.position;
  const count = positions.count;

  // 为每个粒子创建闪烁属性
  const opacities = new Float32Array(count);
  const phases = new Float32Array(count);
  const speeds = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    opacities[i] = Math.random();
    phases[i] = Math.random() * Math.PI * 2;
    speeds[i] = 0.5 + Math.random() * 1.5;
  }

  geometry.setAttribute('opacity', new three.BufferAttribute(opacities, 1));
  geometry.setAttribute('phase', new three.BufferAttribute(phases, 1));
  geometry.setAttribute('speed', new three.BufferAttribute(speeds, 1));

  // 使用ShaderMaterial实现粒子闪烁
  const material = new three.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      pointSize: { value: 2.5 },
      color: { value: new three.Color(0xffffff) }
    },
    vertexShader: `
      attribute float opacity;
      attribute float phase;
      attribute float speed;
      uniform float time;
      uniform float pointSize;
      varying float vOpacity;

      // 三层噪声函数
      float noise1(float t) {
        return sin(t * 2.0 + phase) * 0.5 + 0.5;
      }
      float noise2(float t) {
        return sin(t * 3.7 + phase * 1.3) * 0.5 + 0.5;
      }
      float noise3(float t) {
        return sin(t * 5.1 + phase * 0.7) * 0.5 + 0.5;
      }

      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = pointSize * (300.0 / -mvPosition.z);

        // 三层噪声叠加，产生复杂的闪烁效果
        float t = time * speed * 0.001;
        float n1 = noise1(t);
        float n2 = noise2(t);
        float n3 = noise3(t);
        
        // 组合三层噪声，让透明度在0-1之间变化
        vOpacity = (n1 * 0.4 + n2 * 0.3 + n3 * 0.3);
      }
    `,
    fragmentShader: `
      uniform vec3 color;
      varying float vOpacity;

      void main() {
        // 圆形粒子
        vec2 center = gl_PointCoord - vec2(0.5);
        float dist = length(center);
        if (dist > 0.5) discard;

        // 柔和边缘
        float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
        
        gl_FragColor = vec4(color, alpha * vOpacity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: three.AdditiveBlending
  });

  particleMesh = new three.Points(geometry, material);
  mainGroup.add(particleMesh);
}

watch(
  () => props.nodes,
  () => {
    pruneMotionState();
  },
  { deep: true }
);

onMounted(async () => {
  try {
    three = await ensureThree();
    initScene();
    window.addEventListener('resize', handleResize);
    animate(0);
  } catch (error) {
    emit('error', error instanceof Error ? error.message : '3D 场景初始化失败');
  }
});

onUnmounted(() => {
  destroyScene();
});
</script>

<template>
  <div ref="containerRef" class="three-scene" />
</template>

<style scoped>
.three-scene {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}

.three-scene :deep(canvas) {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
