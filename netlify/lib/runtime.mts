import { getStore, getDeployStore } from "@netlify/blobs";
import type { Context } from "@netlify/functions";
import { persistentStorage, type Dependencies, type Storage } from "./workflow-core.mjs";

export function dependencies(context: Context): Dependencies {
  const environment = context.deploy.context;
  return {
    env: name => Netlify.env.get(name),
    fetch: globalThis.fetch,
    environment,
    storage: (): Storage => {
      const blobs = persistentStorage(environment, Netlify.env.get("CALVREN_DATA_ENV"))
        ? getStore({ name: "calvren-leads", consistency: "strong" })
        : getDeployStore({ name: "calvren-leads", consistency: "strong" });
      return {
        get: (key, options) => blobs.get(key, options),
        getWithMetadata: async (key, options) => {
          const entry = await blobs.getWithMetadata(key, options);
          if (!entry) return null;
          if (typeof entry.etag !== "string" || !entry.etag)
            throw new Error("A storage revision could not be read.");
          return { data: entry.data, etag: entry.etag };
        },
        setJSON: (key, data, options) => blobs.setJSON(key, data, options),
        delete: key => blobs.delete(key),
        list: options => blobs.list(options),
      };
    },
  };
}
