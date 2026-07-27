<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import Button from "primevue/button";
import Message from "primevue/message";
import Skeleton from "primevue/skeleton";
import Tag from "primevue/tag";
import Password from "primevue/password";
import TurnstileWidget from "../components/TurnstileWidget.vue";
import {
  importKeyBase64Url,
  isValidKeyBase64Url,
  decryptData,
  deriveKeyAndVerifier,
  base64ToSalt,
  MIN_PBKDF2_ITERATIONS,
  MAX_PBKDF2_ITERATIONS,
} from "../lib/crypto";
import { probeSecret, revealSecret, deleteSecret, ApiError } from "../lib/api";

type ViewState = "loading" | "not-found" | "ready" | "revealed" | "error";

const route = useRoute();
const id = route.params.id as string;
const fragmentKey = window.location.hash.slice(1);

const turnstileEnabled = import.meta.env.VITE_TURNSTILE_ENABLED === "true";
const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "";
const turnstileWidget = ref<InstanceType<typeof TurnstileWidget> | null>(null);
const turnstileToken = ref<string | null>(null);

const state = ref<ViewState>("loading");
const requiresPassword = ref(false);
const passwordKdf = ref<{ salt: string; iterations: number } | null>(null);
const password = ref("");
const passwordError = ref<string | null>(null);
const viewsRemaining = ref<number | null>(null);
const expiresAtDisplay = ref<string | null>(null);
const plaintext = ref<string | null>(null);
const errorMessage = ref<string | null>(null);
const revealing = ref(false);
const copied = ref(false);

onMounted(async () => {
  try {
    const probe = await probeSecret(id);
    if (!probe.exists) {
      state.value = "not-found";
      return;
    }
    requiresPassword.value = probe.requiresPassword;
    if (requiresPassword.value) {
      const kdf = probe.kdf ?? null;
      passwordKdf.value = kdf;
      // The iteration count round-trips through the server; refuse anything
      // outside sane bounds (too low = weak derivation, too high = DoS).
      if (
        !kdf ||
        !Number.isInteger(kdf.iterations) ||
        kdf.iterations < MIN_PBKDF2_ITERATIONS ||
        kdf.iterations > MAX_PBKDF2_ITERATIONS
      ) {
        state.value = "error";
        errorMessage.value = "This secret's key parameters are invalid.";
        return;
      }
    } else if (!isValidKeyBase64Url(fragmentKey)) {
      // Checked up front so a mangled fragment fails here, before a view is spent.
      state.value = "error";
      errorMessage.value = "This link is missing or has a corrupted decryption key.";
      return;
    }
    viewsRemaining.value = probe.viewsRemaining;
    expiresAtDisplay.value = new Date(probe.expiresAt).toLocaleString();
    state.value = "ready";
  } catch {
    state.value = "error";
    errorMessage.value = "Could not check this secret's status.";
  }
});

async function handleReveal() {
  if (requiresPassword.value && !password.value) return;
  revealing.value = true;
  passwordError.value = null;
  try {
    // Per-attempt local on purpose: the password may change between retries.
    let derivedKey: CryptoKey | null = null;
    let verifier: string | undefined;
    if (requiresPassword.value && passwordKdf.value) {
      const derived = await deriveKeyAndVerifier(
        password.value,
        base64ToSalt(passwordKdf.value.salt),
        passwordKdf.value.iterations
      );
      derivedKey = derived.key;
      verifier = derived.verifier;
    }

    const revealToken = turnstileEnabled ? (turnstileToken.value ?? undefined) : undefined;
    const { ciphertext } = await revealSecret(id, { verifier, turnstileToken: revealToken });
    turnstileToken.value = null;
    turnstileWidget.value?.reset();
    const key = derivedKey ?? (await importKeyBase64Url(fragmentKey));
    plaintext.value = await decryptData(ciphertext, key, id);
    state.value = "revealed";
  } catch (e) {
    turnstileToken.value = null;
    turnstileWidget.value?.reset();
    if (e instanceof ApiError && e.status === 401) {
      passwordError.value = "Incorrect password — try again.";
    } else if (e instanceof ApiError && e.status === 404) {
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
      <h1><i class="pi pi-shield"></i> SecretShare</h1>
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

      <div v-if="requiresPassword" class="ss-field">
        <label for="reveal-password">This secret is password protected</label>
        <Password
          id="reveal-password"
          v-model="password"
          toggleMask
          :feedback="false"
          class="ss-w-full"
          :inputStyle="{ width: '100%' }"
        />
        <Message v-if="passwordError" severity="error" :closable="false" size="small" class="ss-mt">
          {{ passwordError }}
        </Message>
        <p class="ss-hint">
          We'll check your password before this counts as a view — an incorrect password can be retried.
        </p>
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

      <div class="ss-actions">
        <Button
          label="Reveal Secret"
          icon="pi pi-eye"
          :loading="revealing"
          :disabled="(requiresPassword && !password) || (turnstileEnabled && !turnstileToken)"
          @click="handleReveal"
        />
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

    <div class="ss-footer">
      <router-link to="/about"><i class="pi pi-info-circle"></i> What is SecretShare?</router-link>
    </div>
  </div>
</template>
