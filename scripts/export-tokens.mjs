import {readFile,writeFile} from 'node:fs/promises';
const sheets=['tailwind-theme.css','base-tokens.css','recipes.css','typography.css','focus-theme.css'];
const light={},dark={};
for(const file of sheets){
 const css=(await readFile(new URL(`../styles/${file}`,import.meta.url),'utf8')).replace(/\/\*[\s\S]*?\*\//g,'');
 for(const [,selector,body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
  // Component-scoped tokens stay in their recipe. Export the global theme contract.
  const isTheme=selector.trim().startsWith('@theme');
  const isRoot=selector.split(',').some(s=>s.trim()===':root');
  const isDark=selector.split(',').some(s=>[':root.dark','.dark'].includes(s.trim()));
  if(!isTheme&&!isRoot&&!isDark)continue;
  const target=isDark?dark:light;
  for(const [,name,value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))target[name]=value.trim().replace(/\s+/g,' ');
 }
}
const provenance=JSON.parse(await readFile(new URL('../provenance.json',import.meta.url),'utf8'));
const output={name:'Focus',schemaVersion:1,version:'0.1.0',identity:'blue / ink / slate / paper',sourceRevision:provenance.revision,typography:{family:'Inter',tracking:'-0.02em',weightRange:[100,900]},themes:{light,dark:{...light,...dark}},scales:{spacing:{unit:'px',values:[0,2,4,6,8,12,16,20,24,32,40,48,64]},radius:{unit:'px',sm:8,md:10,lg:12,xl:16},type:{unit:'px',xs:12,sm:14,base:16,lg:18,xl:20,'2xl':24,'3xl':30,'4xl':36},controls:{unit:'px',xs:28,sm:32,default:36,lg:40},breakpoints:{unit:'px',sm:640,md:768,lg:1024,xl:1280},layout:{sidebar:'15.5rem',reading:'46rem',content:'88rem'},layers:{base:0,sticky:30,overlay:50,toast:100}}};
await writeFile(new URL('../tokens/tokens.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
await writeFile(new URL('../public/tokens.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
console.log(`Focus tokens: ${Object.keys(light).length} light, ${Object.keys(output.themes.dark).length} dark`);
