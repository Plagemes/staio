import { APPEARANCE_STORAGE_KEY, STYLE_CHOICE_ATTR, STYLE_CHOICE_MAX_WAIT, SYSTEM_DARK_QUERY } from "./applyTheme";
import { DEFAULT_MODE, DEFAULT_THEME, THEMES } from "./themes";

/**
 * Script da inserire in <head>: gira durante la lettura dell'HTML, prima del primo disegno, e applica il tema salvato in localStorage.
 * Duplica in forma minima la logica di applyTheme (non può importare nulla): themeScript.test.ts li tiene allineati.
 * Su /app, se lo stile non è mai stato scelto, segna la radice come in attesa (vedi tokens.css) e toglie l'attesa da solo dopo
 * STYLE_CHOICE_MAX_WAIT ms, senza dipendere da React: se l'app non parte, la pagina non resta nascosta. Se localStorage non risponde
 * l'attesa non si mette affatto (la scelta non potrebbe essere ricordata e la shell non la propone).
 */
export function buildThemeScript(): string {
  const colors: Record<string, readonly [string, string]> = {};
  for (const t of THEMES) colors[t.id] = t.themeColor;
  const j = JSON.stringify;
  return `(function(){try{var d=document,w=window,r=d.documentElement,C=${j(colors)},s=null;
var ok=1;try{s=w.localStorage.getItem(${j(APPEARANCE_STORAGE_KEY)})}catch(e){ok=0}try{s=JSON.parse(s)}catch(e){s=null}
var t=s&&typeof s.theme==="string"&&Object.prototype.hasOwnProperty.call(C,s.theme)?s.theme:${j(DEFAULT_THEME)},m=s&&(s.mode==="light"||s.mode==="dark")?s.mode:${j(DEFAULT_MODE)};
if(t!==${j(DEFAULT_THEME)})r.setAttribute("data-palette",t);
if(m!=="device")r.setAttribute("data-theme",m);
if(ok&&!(s&&s.chosen===true)&&(function(p){return p==="/app"||p==="/app/"})(w.location&&w.location.pathname)){r.setAttribute(${j(STYLE_CHOICE_ATTR)},"pending");
try{w.setTimeout(function(){r.removeAttribute(${j(STYLE_CHOICE_ATTR)})},${STYLE_CHOICE_MAX_WAIT})}catch(e){r.removeAttribute(${j(STYLE_CHOICE_ATTR)})}}
var q=w.matchMedia?w.matchMedia(${j(SYSTEM_DARK_QUERY)}):null;
function u(){var k=m==="dark"||(m==="device"&&q&&q.matches)?1:0,a=d.head?d.head.querySelectorAll('meta[name="theme-color"]'):[];
for(var i=0;i<a.length;i++){a[i].removeAttribute("media");a[i].setAttribute("content",C[t][k])}}
u();d.addEventListener("DOMContentLoaded",u);
if(m==="device"&&q&&q.addEventListener)q.addEventListener("change",u)
}catch(e){}})()`;
}
