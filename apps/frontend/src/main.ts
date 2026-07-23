import { createApp } from "vue";
import PrimeVue from "primevue/config";
import theme from "./theme";
import App from "./App.vue";
import router from "./router";
import "primeicons/primeicons.css";
import "./style.css";

createApp(App)
  .use(router)
  .use(PrimeVue, { theme: { preset: theme } })
  .mount("#app");
