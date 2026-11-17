import { APPEARANCE_STORAGE_KEY, SYSTEM_DARK_QUERY } from "./applyTheme";
import { DEFAULT_MODE, DEFAULT_THEME, THEMES } from "./themes";

/**
 * Script da inserire in <head>: gira durante la lettura dell'HTML, prima del primo disegno, e applica il tema salvato in localStorage.
 * Duplica in forma minima la logica di applyTheme (non può importare nulla): themeScript.test.ts li tiene allineati.
 */
export function buildThemeScript(): string {
  const colors: Record<string, readonly [string, string]> = {};
  for (const t of THEMES) colors[t.id] = t.themeColor;
  const j = JSON.stringify;
  return `(function(){try{var d=document,w=window,r=d.documentElement,C=${j(colors)},s=null;
try{s=JSON.parse(w.localStorage.getItem(${j(APPEARANCE_STORAGE_KEY)}))}catch(e){}
var t=s&&typeof s.theme==="string"&&Object.prototype.hasOwnProperty.call(C,s.theme)?s.theme:${j(DEFAULT_THEME)},m=s&&(s.mode==="light"||s.mode==="dark")?s.mode:${j(DEFAULT_MODE)};
if(t!==${j(DEFAULT_THEME)})r.setAttribute("data-palette",t);
if(m!=="device")r.setAttribute("data-theme",m);
var q=w.matchMedia?w.matchMedia(${j(SYSTEM_DARK_QUERY)}):null;
function u(){var k=m==="dark"||(m==="device"&&q&&q.matches)?1:0,a=d.head?d.head.querySelectorAll('meta[name="theme-color"]'):[];
for(var i=0;i<a.length;i++){a[i].removeAttribute("media");a[i].setAttribute("content",C[t][k])}}
u();d.addEventListener("DOMContentLoaded",u);
if(m==="device"&&q&&q.addEventListener)q.addEventListener("change",u)
}catch(e){}})()`;
}
