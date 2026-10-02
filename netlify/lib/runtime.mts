import { getStore, getDeployStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";
import { persistentStorage, type Dependencies } from "./workflow-core.mjs";

export function dependencies(context: Context): Dependencies {
  const environment = context.deploy.context;
  return {
    env: name => Netlify.env.get(name),
    fetch: globalThis.fetch,
    environment,
    storage: () => persistentStorage(environment, Netlify.env.get("CALVREN_DATA_ENV"))
      ? getStore({ name: "calvren-leads", consistency: "strong" })
      : getDeployStore({ name: "calvren-leads", consistency: "strong" }),
  };
}
