<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import { cspNonce } from "../lib/cspNonce";

const props = defineProps<{ siteKey: string }>();
const emit = defineEmits<{
  verified: [token: string];
  expired: [];
  error: [];
}>();

const container = ref<HTMLDivElement | null>(null);
let widgetId: string | null = null;

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`);
  if (existing) {
    return new Promise((resolve) => existing.addEventListener("load", () => resolve(), { once: true }));
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    // Turnstile copies the nonce off its own script element onto the styles it
    // injects for the widget, so without this the widget renders unstyled
    // under our nonce-based style-src.
    if (cspNonce) script.nonce = cspNonce;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Turnstile script"));
    document.head.appendChild(script);
  });
}

onMounted(async () => {
  await loadScript();
  if (!container.value || !window.turnstile) return;
  widgetId = window.turnstile.render(container.value, {
    sitekey: props.siteKey,
    callback: (token) => emit("verified", token),
    "expired-callback": () => emit("expired"),
    "error-callback": () => emit("error"),
  });
});

onBeforeUnmount(() => {
  if (widgetId !== null && window.turnstile) {
    window.turnstile.remove(widgetId);
  }
});

function reset() {
  if (widgetId !== null && window.turnstile) {
    window.turnstile.reset(widgetId);
  }
}

defineExpose({ reset });
</script>

<template>
  <div ref="container"></div>
</template>
