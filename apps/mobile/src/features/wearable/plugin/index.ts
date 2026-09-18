import { registerPlugin } from "@capacitor/core";
import type { SombreyWearablePlugin } from "./definitions.ts";

export const SombreyWearable = registerPlugin<SombreyWearablePlugin>("SombreyWearable", {
  web: () => import("./web.ts").then((m) => new m.SombreyWearableWeb()),
});

export type { SombreyWearablePlugin } from "./definitions.ts";
