<script setup lang="ts">
import { ref, computed } from "vue";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import Button from "primevue/button";
import Message from "primevue/message";
import { generateRandomKey, encryptData, exportKeyHex } from "../lib/crypto";
import { createSecret, deleteSecret, ApiError } from "../lib/api";

const MAX_PLAINTEXT_WARN_BYTES = 45_000;

const secretText = ref("");
const maxViews = ref(1);
const ttlMinutes = ref(1440);
const loading = ref(false);
const errorMessage = ref<string | null>(null);
const shareUrl = ref<string | null>(null);
const secretId = ref<string | null>(null);
const expiresAtDisplay = ref<string | null>(null);
const copied = ref(false);

const maxViewsOptions = Array.from({ length: 10 }, (_, i) => ({ label: String(i + 1), value: i + 1 }));

const ttlOptions = [
  { label: "10 minutes", value: 10 },
  { label: "1 hour", value: 60 },
  { label: "1 day", value: 1440 },
  { label: "7 days", value: 10080 },
];

const plaintextTooLarge = computed(() => {
  return new TextEncoder().encode(secretText.value).length > MAX_PLAINTEXT_WARN_BYTES;
});

async function handleSubmit() {
  if (!secretText.value) return;
  loading.value = true;
  errorMessage.value = null;
  try {
    const key = await generateRandomKey();
    const { ciphertext } = await encryptData(secretText.value, key);
    const keyHex = await exportKeyHex(key);
    const { id, expiresAt } = await createSecret({
      ciphertext,
      maxViews: maxViews.value,
      ttlMinutes: ttlMinutes.value,
    });
    secretId.value = id;
    expiresAtDisplay.value = new Date(expiresAt).toLocaleString();
    shareUrl.value = `${window.location.origin}/s/${id}#${keyHex}`;
  } catch (e) {
    errorMessage.value = e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
  } finally {
    loading.value = false;
  }
}

async function copyLink() {
  if (!shareUrl.value) return;
  await navigator.clipboard.writeText(shareUrl.value);
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
}

async function burnNow() {
  if (!secretId.value) return;
  try {
    await deleteSecret(secretId.value);
  } finally {
    resetForm();
  }
}

function resetForm() {
  secretText.value = "";
  maxViews.value = 1;
  ttlMinutes.value = 1440;
  shareUrl.value = null;
  secretId.value = null;
  expiresAtDisplay.value = null;
  errorMessage.value = null;
}
</script>

<template>
  <div class="ss-card">
    <div class="ss-header">
      <h1>SecretShare</h1>
      <p>Share a secret with a self-destructing link. Nothing is sent to the server unencrypted.</p>
    </div>

    <template v-if="!shareUrl">
      <div class="ss-field">
        <label for="secret-text">Secret</label>
        <Textarea
          id="secret-text"
          v-model="secretText"
          rows="6"
          autoResize
          style="width: 100%"
          placeholder="Paste the text you want to share..."
        />
        <Message v-if="plaintextTooLarge" severity="warn" :closable="false" size="small">
          This is quite large and may be rejected by the server.
        </Message>
      </div>

      <div class="ss-field">
        <label for="max-views">Max views</label>
        <Select
          id="max-views"
          v-model="maxViews"
          :options="maxViewsOptions"
          optionLabel="label"
          optionValue="value"
          style="width: 100%"
        />
      </div>

      <div class="ss-field">
        <label for="ttl">Expires after</label>
        <Select
          id="ttl"
          v-model="ttlMinutes"
          :options="ttlOptions"
          optionLabel="label"
          optionValue="value"
          style="width: 100%"
        />
      </div>

      <Message v-if="errorMessage" severity="error" :closable="false" style="margin-bottom: 1rem">
        {{ errorMessage }}
      </Message>

      <div class="ss-actions">
        <Button label="Create Secret Link" :loading="loading" :disabled="!secretText" @click="handleSubmit" />
      </div>
    </template>

    <template v-else>
      <Message severity="success" :closable="false" style="margin-bottom: 1rem">
        Your secret link is ready. Expires: {{ expiresAtDisplay }}
      </Message>

      <div class="ss-field">
        <label>Share link</label>
        <div class="ss-secret-text">{{ shareUrl }}</div>
      </div>

      <div class="ss-actions">
        <Button :label="copied ? 'Copied!' : 'Copy Link'" icon="pi pi-copy" @click="copyLink" />
        <Button label="Burn Now" severity="danger" outlined icon="pi pi-trash" @click="burnNow" />
        <Button label="Create Another" severity="secondary" text @click="resetForm" />
      </div>
    </template>
  </div>
</template>
