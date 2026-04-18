import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
	plugins: [react()],
	root: ".",
	build: {
		outDir: "dist-client",
		emptyOutDir: true,
	},
	server: {
		port: 5173,
		proxy: {
			"/api": "http://localhost:7420",
			"/ws": { target: "ws://localhost:7420", ws: true },
		},
	},
});
