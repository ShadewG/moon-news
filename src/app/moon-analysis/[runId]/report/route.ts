import { NextResponse } from "next/server";

import { getMoonAnalysisRun } from "@/server/services/moon-analysis";

type RouteContext = {
  params: Promise<{
    runId: string;
  }>;
};

const ENHANCEMENT = `
<style>
  section{display:none!important}
  #_nav{position:sticky;top:0;z-index:100;background:rgba(11,13,16,0.97);backdrop-filter:blur(12px);border-bottom:1px solid #1e2530}
  #_nav-inner{width:min(1180px,calc(100vw - 32px));margin:0 auto;display:flex;align-items:center;gap:5px;padding:8px 0;overflow-x:auto;scrollbar-width:none}
  #_nav-inner::-webkit-scrollbar{display:none}
  ._nl{font:700 10px/1 monospace;letter-spacing:.18em;text-transform:uppercase;color:#71d09a;padding-right:8px;border-right:1px solid #253042;margin-right:2px;flex-shrink:0}
  ._na{flex-shrink:0;border:1px solid #253042;border-radius:999px;padding:4px 10px;font:600 10px/1 monospace;text-transform:uppercase;letter-spacing:.07em;color:#9aa6b2;text-decoration:none;white-space:nowrap;transition:color .15s,border-color .15s}
  ._na:hover{color:#edf2f7;border-color:#4a5568}
  ._tb{flex-shrink:0;margin-left:auto;border:1px solid #253042;border-radius:999px;padding:4px 10px;font:600 10px/1 monospace;text-transform:uppercase;letter-spacing:.07em;color:#71d09a;background:transparent;cursor:pointer;white-space:nowrap;border-color:rgba(113,208,154,.4)}
  ._tb:hover{background:rgba(113,208,154,.08)}
  ._det{margin-top:12px}
  ._sum{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 16px;background:#0f1319;border:1px solid #1e2530;border-radius:12px;cursor:pointer;list-style:none;user-select:none;transition:background .15s,border-color .15s}
  ._sum::-webkit-details-marker{display:none}
  ._sum:hover,._det[open] ._sum{background:#141b24;border-color:#2a3545}
  ._det[open] ._sum{border-radius:12px 12px 0 0;border-bottom-color:transparent}
  ._sh{margin:0;font-size:14px;font-weight:600;letter-spacing:-.01em;color:#edf2f7}
  ._ic{color:#4a5568;font-size:10px;transition:transform .2s;flex-shrink:0}
  ._det[open] ._ic{transform:rotate(180deg);color:#71d09a}
  ._bd{padding:16px;background:#0b0f16;border:1px solid #1e2530;border-top:none;border-radius:0 0 12px 12px;margin-bottom:0}
  ._bd h2{display:none}
  ._bd p,._bd li{color:#a2adbb}
</style>
<script>
(function(){
  function init(){
    var secs=Array.from(document.querySelectorAll('section')).filter(function(s){return s.querySelector('h2')});
    var nav=document.createElement('nav');nav.id='_nav';
    var inner=document.createElement('div');inner.id='_nav-inner';
    var lbl=document.createElement('span');lbl.className='_nl';lbl.textContent='Moon';inner.appendChild(lbl);
    var dets=[];
    var OPEN_FIRST=2;
    secs.forEach(function(sec,i){
      var h2=sec.querySelector('h2');if(!h2)return;
      var txt=h2.textContent||'';
      var id='_s'+i;
      var det=document.createElement('details');
      if(i<OPEN_FIRST)det.open=true;
      det.id=id;det.className='_det';dets.push(det);
      var sum=document.createElement('summary');sum.className='_sum';
      var th=document.createElement('h2');th.className='_sh';th.textContent=txt;
      var ic=document.createElement('span');ic.className='_ic';ic.textContent='▾';
      sum.appendChild(th);sum.appendChild(ic);det.appendChild(sum);
      var bd=document.createElement('div');bd.className='_bd';
      h2.remove();
      while(sec.firstChild)bd.appendChild(sec.firstChild);
      det.appendChild(bd);
      sec.style.display='';
      sec.parentNode.insertBefore(det,sec);sec.remove();
      var a=document.createElement('a');a.href='#'+id;a.className='_na';
      a.textContent=txt.length>22?txt.slice(0,20)+'\u2026':txt;
      inner.appendChild(a);
    });
    var allOpen=false;
    var btn=document.createElement('button');btn.className='_tb';
    btn.textContent='Expand All';
    btn.onclick=function(){
      allOpen=!allOpen;
      dets.forEach(function(d){d.open=allOpen});
      btn.textContent=allOpen?'Collapse All':'Expand All';
    };
    inner.appendChild(btn);nav.appendChild(inner);
    var shell=document.querySelector('.shell,main');
    if(shell)shell.parentNode.insertBefore(nav,shell);
    else document.body.insertBefore(nav,document.body.firstChild);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
</script>
`;

export async function GET(_request: Request, context: RouteContext) {
  const { runId } = await context.params;
  const run = await getMoonAnalysisRun(runId);

  if (!run) {
    return new NextResponse("Run not found", { status: 404 });
  }

  if (!run.reportHtml) {
    return new NextResponse("Report not ready yet", { status: 409 });
  }

  const enhanced = run.reportHtml.replace(/<\/body>/i, ENHANCEMENT + "\n</body>");

  return new NextResponse(enhanced, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
