const puppeteer = require('puppeteer');
const fs = require('fs');
const MODULES = ['admin','vehicleDriverData'];
(async () => {
  const BASE='http://localhost:3100', OUT='/tmp/ratipa-qa';
  fs.mkdirSync(OUT,{recursive:true});
  const browser = await puppeteer.launch({headless:'new',args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
  const page = await browser.newPage();
  await page.setViewport({width:1440,height:900});
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text());}); page.on('pageerror',e=>errs.push('PE:'+e.message));
  const log=s=>{console.log(s);fs.appendFileSync(`${OUT}/qa4.log`,s+'\n');};
  await page.goto(BASE,{waitUntil:'domcontentloaded',timeout:30000});
  await new Promise(r=>setTimeout(r,1000));
  await page.waitForSelector('#username',{timeout:10000});
  await page.evaluate(()=>{const s=document.querySelector('#username');for(const o of s.options)if(o.value.toLowerCase().includes('сергей')){s.value=o.value;break;}});
  await page.type('#password','ratipa2026');
  await page.click('button[type="submit"]');
  await new Promise(r=>setTimeout(r,2500));
  for(const mod of MODULES){
    const before=errs.length;
    await page.evaluate(m=>{window.location.hash=m;},mod);
    let stuck=true;
    for(let i=0;i<24;i++){ // up to 12s
      await new Promise(r=>setTimeout(r,500));
      const st=await page.evaluate(()=>{const t=document.body.innerText;const sp=/загрузк|loading|подождит|спиннер/i.test(t.slice(0,300));return{len:t.length,sp};});
      if(!st.sp && st.len>400){stuck=false;break;}
    }
    const info=await page.evaluate(()=>{const h=document.querySelector('h1,h2,h3');return{heading:h?h.innerText.trim():'(none)',bodyLen:document.body.innerText.length,btns:document.querySelectorAll('button').length,tables:document.querySelectorAll('table').length,inputs:document.querySelectorAll('input,select,textarea').length,sample:document.body.innerText.replace(/\s+/g,' ').slice(0,200)};});
    await page.screenshot({path:`${OUT}/${mod}.png`});
    log(`[${stuck?'STUCK':'OK'}] ${mod} heading="${info.heading}" body=${info.bodyLen} btns=${info.btns} tbl=${info.tables} errs=+${errs.length-before}`);
    log(`   ${info.sample}`);
  }
  errs.forEach((e,i)=>log(`  E${i}: ${e.slice(0,200)}`));
  await browser.close(); log('DONE');
})().catch(e=>{fs.appendFileSync('/tmp/ratipa-qa/qa4.log','FATAL '+e+'\n');process.exit(1);});
