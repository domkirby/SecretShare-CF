<script setup lang="ts">
import { ref, computed, watch } from "vue";
import Textarea from "primevue/textarea";
import Select from "primevue/select";
import SelectButton from "primevue/selectbutton";
import Password from "primevue/password";
import Button from "primevue/button";
import Message from "primevue/message";
import TurnstileWidget from "../components/TurnstileWidget.vue";
import {
  generateRandomKey,
  encryptData,
  exportKeyBase64Url,
  generateSalt,
  saltToBase64,
  deriveKeyAndVerifier,
  generateSecretId,
  generateSecurePassword,
  PBKDF2_ITERATIONS,
} from "../lib/crypto";
import { createSecret, deleteSecret, ApiError } from "../lib/api";
import { estimatePasswordStrength, type PasswordStrength } from "../lib/passwordStrength";

// Well below the server's real ciphertext-envelope cap; the margin already
// absorbs the ~19 bytes of length-hiding padding added before encryption.
const MAX_PLAINTEXT_WARN_BYTES = 45_000;

const turnstileEnabled = import.meta.env.VITE_TURNSTILE_ENABLED === "true";
const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "";

type Mode = "random" | "password";

const mode = ref<Mode>("random");
const modeOptions = [
  { label: "Random Link", value: "random" },
  { label: "Password", value: "password" },
];

const secretText = ref("");
const password = ref("");
const passwordStrength = ref<PasswordStrength | null>(null);
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
const turnstileToken = ref<string | null>(null);
const turnstileWidget = ref<InstanceType<typeof TurnstileWidget> | null>(null);

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
  if (turnstileEnabled && !turnstileToken.value) return false;
  return true;
});

function suggestPassword() {
  password.value = generateSecurePassword();
}

// Guards against out-of-order results if a slower estimate for an earlier
// keystroke resolves after a faster one for a later keystroke.
let strengthRequestId = 0;
watch(password, async (value) => {
  const requestId = ++strengthRequestId;
  const result = await estimatePasswordStrength(value);
  if (requestId === strengthRequestId) {
    passwordStrength.value = result;
  }
});

async function handleSubmit() {
  if (!canSubmit.value) return;
  loading.value = true;
  errorMessage.value = null;
  try {
    let ciphertext: string;
    let fragmentKey: string | null = null;
    let kdf: { salt: string; iterations: number; verifier: string } | undefined;

    // Generated before encryption because the id is the AES-GCM AAD, binding
    // the ciphertext to its record.
    const id = generateSecretId();

    if (mode.value === "password") {
      const salt = generateSalt();
      const { key, verifier } = await deriveKeyAndVerifier(password.value, salt, PBKDF2_ITERATIONS);
      ({ ciphertext } = await encryptData(secretText.value, key, id));
      kdf = { salt: saltToBase64(salt), iterations: PBKDF2_ITERATIONS, verifier };
    } else {
      const key = await generateRandomKey();
      ({ ciphertext } = await encryptData(secretText.value, key, id));
      fragmentKey = await exportKeyBase64Url(key);
    }

    const { expiresAt } = await createSecret({
      id,
      ciphertext,
      kdf,
      maxViews: maxViews.value,
      ttlMinutes: ttlMinutes.value,
      turnstileToken: turnstileToken.value ?? undefined,
    });
    secretId.value = id;
    expiresAtDisplay.value = new Date(expiresAt).toLocaleString();
    usedPassword.value = mode.value === "password" ? password.value : null;
    shareUrl.value =
      fragmentKey !== null
        ? `${window.location.origin}/s/${id}#${fragmentKey}`
        : `${window.location.origin}/s/${id}`;
  } catch (e) {
    errorMessage.value = e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
    turnstileWidget.value?.reset();
    turnstileToken.value = null;
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
  turnstileToken.value = null;
  turnstileWidget.value?.reset();
}
</script>

<template>
  <div class="ss-card">
    <div class="ss-header">
      <h1><i class="pi pi-shield"></i> SecretShare</h1>
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
          class="ss-w-full"
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
          :feedback="false"
          class="ss-w-full"
          :inputStyle="{ width: '100%' }"
        />
        <div v-if="passwordStrength" class="ss-strength">
          <div class="ss-strength-bar">
            <span
              v-for="segment in 4"
              :key="segment"
              class="ss-strength-segment"
              :class="{ filled: segment <= passwordStrength.score + 1 }"
              :data-score="passwordStrength.score"
            />
          </div>
          <span class="ss-strength-label" :data-score="passwordStrength.score">{{ passwordStrength.label }}</span>
        </div>
        <p v-if="passwordStrength && passwordStrength.score < 3 && passwordStrength.warning" class="ss-hint">
          {{ passwordStrength.warning }}
        </p>
        <Message severity="warn" :closable="false" size="small" class="ss-mt">
          The encryption key is derived directly from this password — a weak password means a weak key, no
          matter how the link itself is protected.
        </Message>
        <p class="ss-hint">
          Share this password with the recipient separately from the link (e.g. a phone call or a different
          chat thread) — it is never included in the link itself.
        </p>
        <Button label="Suggest a password" text size="small" @click="suggestPassword" />
      </div>

      <div class="ss-field-row">
        <div class="ss-field">
          <label for="max-views">Max views</label>
          <Select
            id="max-views"
            v-model="maxViews"
            :options="maxViewsOptions"
            optionLabel="label"
            optionValue="value"
            class="ss-w-full"
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
            class="ss-w-full"
          />
        </div>
      </div>

      <div v-if="turnstileEnabled" class="ss-field">
        <TurnstileWidget
          ref="turnstileWidget"
          :site-key="turnstileSiteKey"
          @verified="(token) => (turnstileToken = token)"
          @expired="turnstileToken = null"
          @error="turnstileToken = null"
        />
      </div>

      <Message v-if="errorMessage" severity="error" :closable="false" class="ss-mb">
        {{ errorMessage }}
      </Message>

      <div class="ss-actions">
        <Button label="Create Secret Link" :loading="loading" :disabled="!canSubmit" @click="handleSubmit" />
      </div>
    </template>

    <template v-else>
      <Message severity="success" :closable="false" class="ss-mb">
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

    <div class="ss-footer">
      <router-link to="/about"><i class="pi pi-info-circle"></i> What is SecretShare?</router-link>
    </div>
  </div>
</template>

<style scoped>
.ss-strength {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-top: 0.5rem;
}

.ss-strength-bar {
  display: flex;
  gap: 0.25rem;
  flex: 1;
}

.ss-strength-segment {
  height: 0.3rem;
  flex: 1;
  border-radius: 999px;
  background: light-dark(#e2e8f0, #33383f);
}

.ss-strength-segment.filled[data-score="0"] {
  background: light-dark(#dc2626, #f87171);
}

.ss-strength-segment.filled[data-score="1"] {
  background: light-dark(#ea580c, #fb923c);
}

.ss-strength-segment.filled[data-score="2"] {
  background: light-dark(#ca8a04, #facc15);
}

.ss-strength-segment.filled[data-score="3"] {
  background: light-dark(#65a30d, #a3e635);
}

.ss-strength-segment.filled[data-score="4"] {
  background: light-dark(#16a34a, #4ade80);
}

.ss-strength-label {
  font-size: 0.85rem;
  font-weight: 600;
  white-space: nowrap;
}

.ss-strength-label[data-score="0"] {
  color: light-dark(#dc2626, #f87171);
}

.ss-strength-label[data-score="1"] {
  color: light-dark(#ea580c, #fb923c);
}

.ss-strength-label[data-score="2"] {
  color: light-dark(#ca8a04, #facc15);
}

.ss-strength-label[data-score="3"] {
  color: light-dark(#65a30d, #a3e635);
}

.ss-strength-label[data-score="4"] {
  color: light-dark(#16a34a, #4ade80);
}
</style>
