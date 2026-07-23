<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import Button from "primevue/button";
import Message from "primevue/message";
import Skeleton from "primevue/skeleton";
import Tag from "primevue/tag";
import { importKeyHex, decryptData } from "../lib/crypto";
import { probeSecret, revealSecret, deleteSecret, ApiError } from "../lib/api";

type ViewState = "loading" | "not-found" | "ready" | "revealed" | "error";

const route = useRoute();
const id = route.params.id as string;
const keyHex = window.location.hash.slice(1);

const state = ref<ViewState>("loading");
const viewsRemaining = ref<number | null>(null);
const expiresAtDisplay = ref<string | null>(null);
const plaintext = ref<string | null>(null);
const errorMessage = ref<string | null>(null);
const revealing = ref(false);
const copied = ref(false);

onMounted(async () => {
  if (!keyHex) {
    state.value = "error";
    errorMessage.value = "This link is missing its decryption key.";
    return;
  }
  try {
    const probe = await probeSecret(id);
    if (!probe.exists) {
      state.value = "not-found";
      return;
    }
    // TODO(pass 3): password-mode UI — probe.requiresPassword is always false this pass.
    viewsRemaining.value = probe.viewsRemaining;
    expiresAtDisplay.value = new Date(probe.expiresAt).toLocaleString();
    state.value = "ready";
  } catch {
    state.value = "error";
    errorMessage.value = "Could not check this secret's status.";
  }
});

async function handleReveal() {
  revealing.value = true;
  try {
    const { ciphertext } = await revealSecret(id);
    const key = await importKeyHex(keyHex);
    plaintext.value = await decryptData(ciphertext, key);
    state.value = "revealed";
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      state.value = "not-found";
    } else {
      state.value = "error";
      errorMessage.value = "Failed to reveal or decrypt this secret. The link may be corrupted or already used.";
    }
  } finally {
    revealing.value = false;
  }
}

async function handleBurn() {
  await deleteSecret(id);
  state.value = "not-found";
}

async function copyPlaintext() {
  if (!plaintext.value) return;
  await navigator.clipboard.writeText(plaintext.value);
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
}
</script>

<template>
  <div class="ss-card">
    <div class="ss-header">
      <h1>SecretShare</h1>
    </div>

    <div v-if="state === 'loading'">
      <Skeleton height="8rem" />
    </div>

    <Message v-else-if="state === 'not-found'" severity="warn" :closable="false">
      This secret has expired, already been viewed, or never existed.
    </Message>

    <Message v-else-if="state === 'error'" severity="error" :closable="false">
      {{ errorMessage }}
    </Message>

    <template v-else-if="state === 'ready'">
      <div class="ss-field">
        <Tag :value="`${viewsRemaining} view(s) remaining`" severity="info" />
        <p>Expires: {{ expiresAtDisplay }}</p>
      </div>
      <div class="ss-actions">
        <Button label="Reveal Secret" icon="pi pi-eye" :loading="revealing" @click="handleReveal" />
        <Button label="Burn Now Without Viewing" severity="danger" outlined icon="pi pi-trash" @click="handleBurn" />
      </div>
    </template>

    <template v-else-if="state === 'revealed'">
      <div class="ss-field">
        <label>Secret</label>
        <div class="ss-secret-text">{{ plaintext }}</div>
      </div>
      <div class="ss-actions">
        <Button :label="copied ? 'Copied!' : 'Copy'" icon="pi pi-copy" @click="copyPlaintext" />
      </div>
    </template>
  </div>
</template>
