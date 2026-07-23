import { createRouter, createWebHistory } from "vue-router";
import CreateSecret from "./views/CreateSecret.vue";
import RevealSecret from "./views/RevealSecret.vue";

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: CreateSecret },
    { path: "/s/:id", component: RevealSecret, props: true },
  ],
});
