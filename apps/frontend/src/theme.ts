import { definePreset } from "@primeuix/themes";
import Aura from "@primeuix/themes/aura";

export default definePreset(Aura, {
  primitive: {
    borderRadius: { none: "0", xs: "4px", sm: "8px", md: "12px", lg: "16px", xl: "24px" },
  },
  semantic: {
    primary: {
      50: "{blue.50}",
      100: "{blue.100}",
      200: "{blue.200}",
      300: "{blue.300}",
      400: "{blue.400}",
      500: "{blue.500}",
      600: "{blue.600}",
      700: "{blue.700}",
      800: "{blue.800}",
      900: "{blue.900}",
      950: "{blue.950}",
      color: "light-dark({blue.500}, {blue.400})",
      contrastColor: "#ffffff",
      hoverColor: "light-dark({blue.600}, {blue.300})",
      activeColor: "light-dark({blue.700}, {blue.200})",
    },
  },
  components: {
    button: {
      root: {
        borderRadius: "2rem",
      },
    },
  },
});
