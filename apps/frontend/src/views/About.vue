<template>
  <div class="ss-card">
    <router-link to="/" class="ss-back-link"><i class="pi pi-arrow-left"></i> Back</router-link>

    <div class="ss-header">
      <h1><i class="pi pi-shield"></i> About SecretShare</h1>
    </div>

    <div class="ss-about">
      <h2>What is this?</h2>
      <p>
        SecretShare lets you send a password, API key, or any other sensitive note to someone through a
        link that destroys itself after it's been viewed (or after it expires) — so it isn't sitting around
        in a chat log or an email thread forever.
      </p>

      <h2>How to use it</h2>
      <ol>
        <li>Paste the secret, choose how many times it can be viewed and how long it should last.</li>
        <li>Optionally protect it with a password instead of a random link.</li>
        <li>Click <strong>Create Secret Link</strong> — you'll get a link to send.</li>
        <li>
          Send the link to whoever needs it. If you chose password mode, send the password too, but through
          a <em>different</em> channel (a text, a call) — never alongside the link itself.
        </li>
        <li>
          When they open the link, they'll need to explicitly click <strong>Reveal</strong> — that's the
          moment it counts as a view. Once the view limit is reached, or it expires, the secret is gone for
          good.
        </li>
      </ol>

      <h2>Zero-knowledge, really</h2>
      <p>
        Encryption and decryption both happen in your browser, never on the server. In random-link mode, the
        decryption key lives only in the link itself, after the <code>#</code> — browsers never send that
        part of a URL over the network, so it never reaches any server at all. In password mode, the
        password never leaves your browser either; the server only ever stores an encrypted blob it has no
        way to read.
      </p>
      <p>That also means: if you lose the link (or the password), nobody — including us — can recover it.</p>
    </div>
  </div>
</template>
