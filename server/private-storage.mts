import { Buffer } from "node:buffer";
import type { Storage, WriteConditions } from "../netlify/lib/workflow-core.mjs";
export interface StorageOptions { url: string; key: string; fetch?: typeof fetch; }
export class SupabasePrivateStorage implements Storage {
  private base: string;
  private headers: Record<string,string>;
  private fetcher: typeof fetch;
  constructor(options: StorageOptions) {
    const url = new URL(options.url);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid database configuration.");
    this.base = url.origin + "/rest/v1/";
    this.headers = {apikey:options.key,"Content-Type":"application/json"};
    if (!/^sb_secret_[a-zA-Z0-9_-]+$/.test(options.key)) {
      try {
        const payload = JSON.parse(Buffer.from(options.key.split(".")[1],"base64url").toString());
        if (payload.role !== "service_role") throw new Error();
      } catch { throw new Error("Use a server-only database credential."); }
      this.headers.Authorization = "Bearer " + options.key;
    }
    this.fetcher = options.fetch ?? fetch;
  }
  private valid(key: string) {
    if (!/^(leads|tombstones|feedback)\/[a-f0-9-]{36}$/.test(key)) throw new Error("Invalid storage key.");
  }
  private async call(path: string, method = "GET", data?: unknown): Promise<any> {
    const response = await this.fetcher(this.base + path, {method,headers:this.headers,signal:AbortSignal.timeout(15000),
      ...(data === undefined ? {} : {body:JSON.stringify(data)})});
    if (!response.ok) throw new Error("Private storage is unavailable.");
    return response.status === 204 ? undefined : response.json();
  }
  async getWithMetadata(key: string, _options: {type:"json"}) {
    this.valid(key);
    const rows = await this.call("calvren_private_records?" + new URLSearchParams({key:"eq."+key,select:"data,etag",limit:"1"}));
    if (!Array.isArray(rows)) throw new Error("Invalid storage response.");
    if (!rows.length) return null;
    if (!rows[0].etag || typeof rows[0].etag !== "string") throw new Error("Invalid storage revision.");
    return {data:rows[0].data,etag:rows[0].etag};
  }
  async get(key: string, options: {type:"json"}) { return (await this.getWithMetadata(key,options))?.data ?? null; }
  async setJSON(key: string, data: unknown, conditions?: WriteConditions): Promise<{modified:boolean;etag?:string}> {
    this.valid(key);
    const result = await this.call("rpc/calvren_private_write","POST",{
      p_key:key,p_data:data,p_only_new:conditions?.onlyIfNew === true,p_expected_etag:conditions?.onlyIfMatch ?? null
    });
    if (typeof result?.modified !== "boolean") throw new Error("Invalid storage write response.");
    return {modified:result.modified,...(result.etag?{etag:result.etag}:{})};
  }
  async delete(key: string) { this.valid(key); await this.call("calvren_private_records?" + new URLSearchParams({key:"eq."+key}),"DELETE"); }
  async *list(options: {prefix:string;paginate:true}) {
    if (!["leads/","feedback/"].includes(options.prefix)) throw new Error("Invalid storage prefix.");
    // The existing inbox is capped at 100 records per view, with newest records first.
    const rows = await this.call("calvren_private_records?" + new URLSearchParams({key:"like."+options.prefix+"*",select:"key",order:"created_at.desc",limit:"100"}));
    if (!Array.isArray(rows) || rows.some(row=>typeof row.key !== "string")) throw new Error("Invalid storage list.");
    yield {blobs:rows.map(row=>({key:row.key}))};
  }
}
