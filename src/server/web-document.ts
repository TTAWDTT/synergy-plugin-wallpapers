import { readFile } from "node:fs/promises"
import { join } from "node:path"

export async function wallpaperDocument(file: string, projectRoot: string): Promise<string> {
  const html = await readFile(file, "utf8")
  const project = await readFile(join(projectRoot, "project.json"), "utf8").then((text) => JSON.parse(text.replace(/^\uFEFF/, ""))).catch(() => ({}))
  const properties: Record<string, { value: unknown }> = {}
  for (const [key, property] of Object.entries(project.general?.properties ?? {})) {
    if (property && typeof property === "object" && "value" in property) properties[key] = { value: property.value }
  }
  const values = JSON.stringify(properties).replace(/</g, "\\u003c")
  const bootstrap = `<script>(function(){
var failed=false;
function report(state,message){window.parent.postMessage({source:"synergy-wallpapers",state:state,message:message},"*")}
function fail(error){failed=true;report("error",String(error&&error.message||error||"网页壁纸运行失败").slice(0,300))}
if(window.console&&typeof window.console.error==="function"){var originalError=window.console.error;window.console.error=function(){originalError.apply(window.console,arguments);for(var index=0;index<arguments.length;index++){var value=arguments[index];if(value&&typeof value==="object"&&typeof value.message==="string"){fail(value);break}}}}
window.addEventListener("error",function(event){fail(event.error||event.message)});
window.addEventListener("unhandledrejection",function(event){fail(event.reason)});
window.addEventListener("securitypolicyviolation",function(){fail("网页壁纸访问了沙箱不允许的资源")});
window.wallpaperRegisterAudioListener=window.wallpaperRegisterAudioListener||function(listener){listener(Array(128).fill(0))};
window.addEventListener("load",function(){
try{var listener=window.wallpaperPropertyListener;if(listener&&typeof listener.applyUserProperties==="function")listener.applyUserProperties(${values});if(!failed)report("ready","")}catch(error){fail(error)}
},{once:true});
})();</script>`
  return /<head(?:\s[^>]*)?>/i.test(html) ? html.replace(/<head(?:\s[^>]*)?>/i, (head) => head + bootstrap) : bootstrap + html
}
