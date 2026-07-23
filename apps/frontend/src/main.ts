import { createApp } from "vue";
import PrimeVue from "primevue/config";
import Aura from "@primeuix/themes/aura";
import App from "./App.vue";
import router from "./router";
import "primeicons/primeicons.css";
import "./style.css";

createApp(App)
  .use(router)
  .use(PrimeVue, { theme: { preset: Aura } })
  .mount("#app");
