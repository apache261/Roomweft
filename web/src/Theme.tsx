import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';

type Preference='light'|'dark'|'system';
const storageKey='tour-studio-theme';
const valid=(value:string|null):Preference=>value==='light'||value==='dark'?value:'system';
function stored():Preference{try{return valid(localStorage.getItem(storageKey));}catch{return 'system';}}
const ThemeContext=createContext<{preference:Preference;resolved:'light'|'dark';change:(value:Preference)=>void}>({preference:'system',resolved:'light',change:()=>{}});
export const useTheme=()=>useContext(ThemeContext);
export function ThemeProvider({children}:{children:ReactNode}){
 const [preference,setPreference]=useState(stored);
 const [systemDark,setSystemDark]=useState(()=>matchMedia('(prefers-color-scheme: dark)').matches);
 useEffect(()=>{const media=matchMedia('(prefers-color-scheme: dark)'),update=()=>setSystemDark(media.matches),sync=(event:StorageEvent)=>{if(event.key===storageKey||event.key===null)setPreference(stored());};media.addEventListener('change',update);window.addEventListener('storage',sync);return()=>{media.removeEventListener('change',update);window.removeEventListener('storage',sync);};},[]);
 useEffect(()=>{const theme=preference==='system'?(systemDark?'dark':'light'):preference;document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#18232c':'#f6f7f2');},[preference,systemDark]);
 const change=(value:Preference)=>{setPreference(value);try{localStorage.setItem(storageKey,value);}catch{/* The current session still supports themes when storage is unavailable. */}};
 return <ThemeContext.Provider value={{preference,resolved:preference==='system'?(systemDark?'dark':'light'):preference,change}}>{children}</ThemeContext.Provider>;
}
export function ThemeSwitch(){const {preference,change}=useContext(ThemeContext);return <label className="theme-switch">Theme<select aria-label="Color theme" value={preference} onChange={e=>change(valid(e.target.value))}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>;}
