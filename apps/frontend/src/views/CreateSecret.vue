<script setup lang="ts">
import { ref, computed } from "vue";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import Password from "primevue/password";
import Button from "primevue/button";
import Message from "primevue/message";
import {
  generateRandomKey,
  encryptData,
  exportKeyHex,
  generateSalt,
  saltToBase64,
  deriveKeyFromPassword,
  generateSecurePassword,
  PBKDF2_ITERATIONS,
} from "../lib/crypto";
import { createSecret, deleteSecret, ApiError } from "../lib/api";

const MAX_PLAINTEXT_WARN_BYTES = 45_000;

type Mode = "random" | "password";

const mode = ref<Mode>("random");
const modeOptions = [
  { label: "Random Link", value: "random" },
  { label: "Password", value: "password" },
];

const secretText = ref("");
const password = ref("");
const maxViews = ref(1);
const ttlMinutes = ref(1440);
const loading = ref(false);
const errorMessage = ref<string | null>(null);
const shareUrl = ref<string | null>(null);
const secretId = ref<string | null>(null);
const expiresAtDisplay = ref<string | null>(null);
const usedPassword = ref<string | null>(null);
const copied = ref(false);
const passwordCopied = ref(false);

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

const canSubmit = computed(() => {
  if (!secretText.value) return false;
  if (mode.value === "password" && !password.value) return false;
  return true;
});

function suggestPassword() {
  password.value = generateSecurePassword();
}

async function handleSubmit() {
  if (!canSubmit.value) return;
  loading.value = true;
  errorMessage.value = null;
  try {
    let ciphertext: string;
    let keyHex: string | null = null;
    let kdf: { salt: string; iterations: number } | undefined;

    if (mode.value === "password") {
      const salt = generateSalt();
      const key = await deriveKeyFromPassword(password.value, salt, PBKDF2_ITERATIONS);
      ({ ciphertext } = await encryptData(secretText.value, key));
      kdf = { salt: saltToBase64(salt), iterations: PBKDF2_ITERATIONS };
    } else {
      const key = await generateRandomKey();
      ({ ciphertext } = await encryptData(secretText.value, key));
      keyHex = await exportKeyHex(key);
    }

    const { id, expiresAt } = await createSecret({
      ciphertext,
      kdf,
      maxViews: maxViews.value,
      ttlMinutes: ttlMinutes.value,
    });
    secretId.value = id;
    expiresAtDisplay.value = new Date(expiresAt).toLocaleString();
    usedPassword.value = mode.value === "password" ? password.value : null;
    shareUrl.value =
      keyHex !== null
        ? `${window.location.origin}/s/${id}#${keyHex}`
        : `${window.location.origin}/s/${id}`;
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

async function copyPassword() {
  if (!usedPassword.value) return;
  await navigator.clipboard.writeText(usedPassword.value);
  passwordCopied.value = true;
  setTimeout(() => (passwordCopied.value = false), 2000);
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
  password.value = "";
  mode.value = "random";
  maxViews.value = 1;
  ttlMinutes.value = 1440;
  shareUrl.value = null;
  secretId.value = null;
  expiresAtDisplay.value = null;
  usedPassword.value = null;
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
        <label>Protect with</label>
        <SelectButton
          v-model="mode"
          :options="modeOptions"
          optionLabel="label"
          optionValue="value"
          :allowEmpty="false"
        />
      </div>

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

      <div v-if="mode === 'password'" class="ss-field">
        <label for="password">Password</label>
        <Password
          id="password"
          v-model="password"
          toggleMask
          :feedback="true"
          style="width: 100%"
          :inputStyle="{ width: '100%' }"
        />
        <p style="font-size: 0.85rem; margin-top: 0.4rem">
          Share this password with the recipient separately from the link (e.g. a phone call or a different
          chat thread) — it is never included in the link itself.
        </p>
        <Button label="Suggest a password" text size="small" @click="suggestPassword" />
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
        <Button label="Create Secret Link" :loading="loading" :disabled="!canSubmit" @click="handleSubmit" />
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

      <div v-if="usedPassword" class="ss-field">
        <label>Password (share via a separate channel)</label>
        <div class="ss-secret-text">{{ usedPassword }}</div>
      </div>

      <div class="ss-actions">
        <Button :label="copied ? 'Copied!' : 'Copy Link'" icon="pi pi-copy" @click="copyLink" />
        <Button
          v-if="usedPassword"
          :label="passwordCopied ? 'Copied!' : 'Copy Password'"
          icon="pi pi-key"
          severity="secondary"
          @click="copyPassword"
        />
        <Button label="Burn Now" severity="danger" outlined icon="pi pi-trash" @click="burnNow" />
        <Button label="Create Another" severity="secondary" text @click="resetForm" />
      </div>
    </template>
  </div>
</template>
