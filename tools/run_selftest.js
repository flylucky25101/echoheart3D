'use strict';
// Runs selftest.js under the headless mocks to verify the suite passes.
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const harness=fs.readFileSync(path.join(__dirname,'headless_test.js'),'utf8');
// reuse only the mock section (everything before "// ---------------- load game scripts")
const mocks='// mocks\n//'+harness
  .split('// ---------------- DOM mock')[1]
  .split('// ---------------- load game scripts')[0];
const texReport=JSON.parse(fs.readFileSync(path.join(__dirname,'texture_report.json'),'utf8'));
global.__texDims={};
texReport.forEach(r=>{const d=r.dim.split('x').map(Number);global.__texDims[r.path]=[d[0],d[1]];});
const spriteSrc=fs.readFileSync(path.join(ROOT,'scripts','sprite-data.js'),'utf8');
const SHEETS=JSON.parse(spriteSrc.match(/EH\.SpriteSheets=(\{.*?\});/s)[1]);
Object.keys(SHEETS).forEach(k=>{global.__texDims[SHEETS[k].path]=[SHEETS[k].w,SHEETS[k].h];});
new Function(mocks).call(global);
const html=fs.readFileSync(path.join(ROOT,'tests.html'),'utf8');
const order=[...html.matchAll(/src="scripts\/([^"]+)\.js"/g)].map(m=>m[1]);
for(const n of order){
  const code=fs.readFileSync(path.join(ROOT,'scripts',n+'.js'),'utf8');
  try{ new Function(code).call(global); }catch(e){ console.error('LOAD FAIL',n,e.message); process.exit(2); }
}
const EH=global.window.EchoHeart;
EH.Save.load();
EH.SelfTest.run(function(sum){
  console.log('\n=== tests.html self-test suite (headless) ===');
  sum.results.forEach(r=>console.log((r.ok?'  PASS  ':'  FAIL  ')+r.name+(r.extra?'   ['+r.extra+']':'')));
  console.log(`\ntotal ${sum.total}  passed ${sum.passed}  failed ${sum.failed}`);
  fs.writeFileSync(path.join(__dirname,'selftest_results.json'),JSON.stringify(sum,null,1));
  process.exit(sum.failed?1:0);
});
