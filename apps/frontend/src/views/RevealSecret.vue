<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import Button from "primevue/button";
import Message from "primevue/message";
import Skeleton from "primevue/skeleton";
import Tag from "primevue/tag";
import Password from "primevue/password";
import { importKeyHex, decryptData, deriveKeyFromPassword, deriveVerifier, base64ToSalt } from "../lib/crypto";
import { probeSecret, revealSecret, verifyPassword, deleteSecret, ApiError } from "../lib/api";

type ViewState = "loading" | "not-found" | "ready" | "revealed" | "error";

const route = useRoute();
const id = route.params.id as string;
const keyHex = window.location.hash.slice(1);

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
      passwordKdf.value = probe.kdf ?? null;
    } else if (!keyHex) {
      state.value = "error";
      errorMessage.value = "This link is missing its decryption key.";
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
    if (requiresPassword.value && passwordKdf.value) {
      const verifier = await deriveVerifier(
        password.value,
        base64ToSalt(passwordKdf.value.salt),
        passwordKdf.value.iterations
      );
      const valid = await verifyPassword(id, verifier);
      if (!valid) {
        passwordError.value = "Incorrect password — try again.";
        return;
      }
    }

    const { ciphertext, kdf } = await revealSecret(id);
    const key =
      requiresPassword.value && kdf
        ? await deriveKeyFromPassword(password.value, base64ToSalt(kdf.salt), kdf.iterations)
        : await importKeyHex(keyHex);
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

      <div class="ss-actions">
        <Button
          label="Reveal Secret"
          icon="pi pi-eye"
          :loading="revealing"
          :disabled="requiresPassword && !password"
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
