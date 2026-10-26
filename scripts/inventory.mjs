import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const root=path.resolve(import.meta.dirname,'..');
const locales={es:{},en:{}};
const i18nText=fs.readFileSync(path.join(root,'catalog/_lib/catalog-i18n.tsx'),'utf8');
const i18nTree=ts.createSourceFile('catalog-i18n.tsx',i18nText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
for(const statement of i18nTree.statements)if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations){
 if(ts.isIdentifier(declaration.name)&&['es','en'].includes(declaration.name.text)&&declaration.initializer&&ts.isObjectLiteralExpression(declaration.initializer))for(const property of declaration.initializer.properties)if(ts.isPropertyAssignment(property)&&ts.isStringLiteral(property.name)&&ts.isStringLiteral(property.initializer))locales[declaration.name.text][property.name.text]=property.initializer.text;
}
function property(node,name){return node.properties.find(p=>ts.isPropertyAssignment(p)&&p.name?.getText().replace(/["']/g,'')===name)?.initializer;}
function resolve(node){if(!node)return '';if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))return node.text;if(ts.isCallExpression(node)&&node.expression.getText()==='ct'&&ts.isStringLiteral(node.arguments[0]))return locales.es[node.arguments[0].text]??node.arguments[0].text;return node.getText();}
const entries=[];
for(const name of fs.readdirSync(path.join(root,'catalog/_registry')).filter(name=>name.endsWith('.tsx'))){
 const tree=ts.createSourceFile(name,fs.readFileSync(path.join(root,'catalog/_registry',name),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 function visit(node){
  if(ts.isObjectLiteralExpression(node)&&property(node,'source')&&property(node,'demos'))entries.push({name:resolve(property(node,'name')),source:resolve(property(node,'source')),id:resolve(property(node,'id')),registry:name});
  if(ts.isCallExpression(node)&&node.expression.getText()==='row'&&node.arguments.length>=5)entries.push({name:resolve(node.arguments[0]),source:resolve(node.arguments[1]),id:'focus-'+resolve(node.arguments[0]).toLowerCase().replace(/\W+/g,'-'),registry:name});
  ts.forEachChild(node,visit);
 }
 visit(tree);
}
const componentFiles=[];function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isDirectory())walk(file);else if(item.name.endsWith('.tsx'))componentFiles.push(path.relative(root,file));}}walk(path.join(root,'components'));
const manifest={name:'Focus',version:'0.1.0',documentedEntries:entries.length,componentModules:componentFiles.length,entries,modules:componentFiles.sort()};
fs.writeFileSync(path.join(root,'catalog/manifest.json'),JSON.stringify(manifest,null,2)+'\n');
let md=`# Inventario de componentes\n\n${entries.length} entradas documentadas y ${componentFiles.length} módulos de componentes React, con primitivas compuestas y utilidades internas. El catálogo muestra variantes, código y las API principales; este índice permite localizar las fuentes.\n\n`;
for(const name of [...new Set(entries.map(entry=>entry.registry))]){
 md+=`## ${name.replace('.tsx','')}\n\n| Pieza | Fuente |\n| --- | --- |\n`;
 for(const entry of entries.filter(entry=>entry.registry===name))md+=`| ${entry.name.replace(/\|/g,'/')} | \`${entry.source}\` |\n`;
 md+='\n';
}
md+='## Módulos adicionales\n\nAlgunos archivos son motores, wrappers o variantes de una pieza compuesta; no todos tienen una demo independiente. Los subpaths públicos están en package.json.\n\n';
for(const file of componentFiles.sort())md+=`- \`${file}\`\n`;
md+='\nRegenera este índice con `pnpm inventory`.\n';
fs.writeFileSync(path.join(root,'docs/components.md'),md);
console.log(`Inventory: ${entries.length} documented entries, ${componentFiles.length} React component modules.`);
