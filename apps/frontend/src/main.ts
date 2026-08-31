import { createApp } from "vue";
import PrimeVue from "primevue/config";
import theme from "./theme";
import App from "./App.vue";
import router from "./router";
import { cspNonce } from "./lib/cspNonce";
import "primeicons/primeicons.css";
import "./style.css";

createApp(App)
  .use(router)
  // The theme preset is compiled to CSS and injected as a <style> element at
  // runtime, so it needs the nonce to survive style-src.
  .use(PrimeVue, { theme: { preset: theme }, csp: { nonce: cspNonce } })
  .mount("#app");
