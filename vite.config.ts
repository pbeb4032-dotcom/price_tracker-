import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, "/");

          if (!normalizedId.includes("node_modules/")) {
            return;
          }

          const nodeModulesPath = normalizedId.split("node_modules/")[1];
          const parts = nodeModulesPath?.split("/") ?? [];
          const packageName = parts[0]?.startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];

          if (!packageName) {
            return;
          }

          if (packageName.startsWith("@radix-ui/")) {
            return "radix-ui";
          }

          if (
            packageName === "recharts" ||
            packageName === "recharts-scale" ||
            packageName === "react-smooth" ||
            packageName === "victory-vendor" ||
            packageName.startsWith("d3-")
          ) {
            return "charts";
          }

          if (["react-hook-form", "@hookform/resolvers", "zod"].includes(packageName)) {
            return "forms";
          }

          if (packageName === "lucide-react") {
            return "icons";
          }

          if (packageName.startsWith("@zxing/")) {
            return "scanner";
          }
        },
      },
    },
  },
}));
