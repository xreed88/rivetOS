// Flattens each .dc.html artboard (holes, sc-if, sc-for) to static HTML and
// screenshots it. Usage: node render.cjs <canvas dir> <output dir>
const fs=require('fs'),path=require('path');
const {chromium}=require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright');
const dir=process.argv[2], out=process.argv[3];
// [source artboard, output name, tweak props, viewport height]
const jobs=[
 ['Main.dc.html','A-tiled-tokyo-night',{}],
 ['Main.dc.html','A-tiled-tokyo-night-details-open',{detailsOpen:true}],
 ['Main.dc.html','A-tiled-gruvbox',{theme:'gruvbox'}],
 ['Waybar.dc.html','B-bar-first-catppuccin',{}],
 ['Waybar.dc.html','B-bar-first-latte',{theme:'catppuccin-latte'}],
 ['Synthwave.dc.html','C-synthwave',{}],
 ['Synthwave.dc.html','C-synthwave-scanlines',{scanlines:true}],
 ['Logos.dc.html','logos/logos-tokyo-night',{}],
 ['Logos.dc.html','logos/logos-gruvbox-accent',{accent:'#fabd2f'}],
 ['Colorways.dc.html','logos/logos-colorways',{},1040],
];
function get(o,p){return p.split('.').reduce((a,k)=>a==null?a:a[k],o)}
function build(src,props){
  const helmet=(src.match(/<helmet>([\s\S]*?)<\/helmet>/)||[,''])[1];
  let body=src.match(/<x-dc>([\s\S]*?)<\/x-dc>/)[1].replace(/<helmet>[\s\S]*?<\/helmet>/,'');
  const script=src.match(/data-dc-script[^>]*>([\s\S]*?)<\/script>/)[1];
  const Component=new Function('DCLogic',script+';return Component')(class{});
  const c=new Component(); c.props=props; const v=c.renderVals();
  body=body.replace(/<sc-for list="\{\{\s*(\w+)\s*\}\}" as="(\w+)"[^>]*>([\s\S]*?)<\/sc-for>/g,(m,k,as,inner)=>v[k].map(it=>inner.replace(new RegExp('\\{\\{\\s*'+as+'\\.(\\w+)\\s*\\}\\}','g'),(mm,f)=>String(it[f]))).join(''));
  body=body.replace(/<sc-if value="\{\{\s*(\w+)\s*\}\}"[^>]*>([\s\S]*?)<\/sc-if>/g,(m,k,inner)=>v[k]?inner:'');
  body=body.replace(/\{\{\s*([\w.]+)\s*\}\}/g,(m,p)=>{const r=get(v,p);return r==null?'':String(r).replace(/"/g,'&quot;')});
  return `<!doctype html><html><head><meta charset="utf-8">${helmet}</head><body>${body}</body></html>`;
}
(async()=>{
  const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined});
  const pg=await b.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
  for(const [f,name,props,h] of jobs){
    await pg.setViewportSize({width:1440,height:h||900});
    const html=build(fs.readFileSync(path.join(dir,f),'utf8'),props);
    fs.writeFileSync(path.join(out,name+'.html'),html);
    await pg.setContent(html,{waitUntil:'load',timeout:8000}).catch(()=>{});
    await pg.evaluate(()=>document.fonts.ready);
    await pg.screenshot({path:path.join(out,name+'.png')});
    console.log('ok',name, await pg.evaluate(()=>[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family).join(',')));
  }
  await b.close();
})();
