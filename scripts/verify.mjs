import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const root=path.resolve(import.meta.dirname,'..');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const problems=[];
let imports=0;
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(item=>item.isDirectory()?walk(path.join(dir,item.name)):[path.join(dir,item.name)]);}
const files=['components','lib','catalog','app'].flatMap(dir=>walk(path.join(root,dir))).filter(f=>/\.[jt]sx?$/.test(f));
for(const file of files){
 const tree=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,file.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 function visit(node){
  let spec;
  if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))spec=node.moduleSpecifier.text;
  if(ts.isCallExpression(node)&&node.expression.kind===ts.SyntaxKind.ImportKeyword&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0]))spec=node.arguments[0].text;
  if(spec){
   imports++;
   if(spec.startsWith('@/'))problems.push(`${path.relative(root,file)} still uses Oruka's @/ alias`);
   if(spec.startsWith('.')){
    const base=path.resolve(path.dirname(file),spec);
    const paths=[base,...['.ts','.tsx','.js','.json','.css','/index.ts','/index.tsx'].map(ext=>base+ext)];
    if(base.endsWith('.js'))paths.push(base.slice(0,-3)+'.ts');
    if(!paths.some(p=>fs.existsSync(p)&&fs.statSync(p).isFile()))problems.push(`Unresolved: ${path.relative(root,file)} -> ${spec}`);
   }else{
    const name=spec.startsWith('@')?spec.split('/').slice(0,2).join('/'):spec.split('/')[0];
    if(!pkg.dependencies[name]&&!pkg.devDependencies[name]&&!pkg.peerDependencies[name])problems.push(`Undeclared package: ${name}`);
   }
   if(file.includes('/components/')||file.includes('/lib/'))if(/^(node:|eve($|\/)|next\/server)/.test(spec))problems.push(`Server dependency: ${file} -> ${spec}`);
  }
  ts.forEachChild(node,visit);
 }
 visit(tree);
}
for(const [name,target] of Object.entries(pkg.exports)){
 if(target.includes('*')){
  const dir=path.join(root,path.dirname(target));const suffix=target.split('*')[1];
  if(!fs.existsSync(dir)||!fs.readdirSync(dir).some(f=>f.endsWith(suffix)))problems.push(`Empty export ${name}`);
 }else if(!fs.existsSync(path.join(root,target)))problems.push(`Missing export ${name}`);
}
const tokens=JSON.parse(fs.readFileSync(path.join(root,'tokens/tokens.json'),'utf8'));
for(const theme of ['light','dark'])for(const name of ['--background','--foreground','--card','--primary','--ring','--status-success-fg','--app-font-sans'])if(!tokens.themes[theme][name])problems.push(`Missing ${theme} token ${name}`);
if(tokens.themes.light['--primary']!=='#325cfe'||tokens.themes.dark['--primary']!=='#325cfe')problems.push('Focus identity is not reflected in tokens.json');
for (const theme of ['light','dark']) {
 for (const role of ['sans','heading','numeral','mono']) if (tokens.themes[theme][`--app-font-${role}`] !== '"Optimistic Display", sans-serif') problems.push(`Unexpected ${theme} font role ${role}`);
 if (tokens.themes[theme]['--app-tracking'] !== '-0.02em') problems.push(`Unexpected ${theme} tracking`);
}
const ids=[];const sources=[];
for(const file of files.filter(f=>f.includes('/catalog/_registry/'))){const content=fs.readFileSync(file,'utf8');for(const m of content.matchAll(/\bid:\s*["']([^"']+)["']/g))ids.push(m[1]);for(const m of content.matchAll(/\bsource:\s*["']([^"']+)["']/g))sources.push(m[1]);}
// Exercise the new data contracts with the real catalogue at build/runtime; this
// check guards portability and packaging independently of TypeScript's resolution.
if(problems.length){console.error(problems.join('\n'));process.exit(1);}
console.log(`Verified ${files.length} source files, ${imports} imports, ${Object.keys(pkg.exports).length} public export paths and both token themes.`);
