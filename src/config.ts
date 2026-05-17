import { createMeshConfig } from "@baditaflorin/mesh-common";

export const config = createMeshConfig({
  appName: "mesh-hot-potato",
  description: "Virtual hot potato — shake to fling, vibrate while holding, timer = elimination.",
  accentHex: "#ff5c33",
  version: __APP_VERSION__,
  commit: __GIT_COMMIT__,
});
