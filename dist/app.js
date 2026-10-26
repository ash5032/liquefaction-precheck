import * as pdfjs from './vendor/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.mjs',import.meta.url).href;
const $=id=>document.getElementById(id),E=window.Liquefaction;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state={config:{project:'',hole:'',water:'',fill:0,origin:'before',waterDatum:'final',imageStart:0,imageEnd:'',imageBasis:'table',imageAuto:true},layers:[],samples:[]},pages=[],active=-1,worker=null,busy=false,currentResult=null;
let regions={geology:null},dragMode=null,start=null;
function status(text,error=false){$('progress').textContent=text;$('progress').classList.toggle('error-text',error);}
function setBusy(v){busy=v;document.body.classList.toggle('busy',v);$('extractBtn').disabled=v||active<0;$('cropOCR').disabled=v;$('boreholeFile').disabled=v;$('demoBtn').disabled=v;$('projectFile').disabled=v;$('pageSelect').disabled=v;$('clearLayers').disabled=v;$('clearSamples').disabled=v;}
function readConfig(){for(const id of ['project','hole','water','fill','origin','waterDatum','imageStart','imageEnd','imageBasis'])state.config[id]=$(id).value;state.config.imageAuto=$('imageAuto').checked;}
function applyConfig(){for(const id of ['project','hole','water','fill','origin','waterDatum','imageStart','imageEnd','imageBasis'])$(id).value=state.config[id]??({imageStart:0,imageBasis:'table'}[id]??'');$('imageAuto').checked=state.config.imageAuto??false;syncImageAuto();}
function dirty(){currentResult=null;$('reviewed').checked=false;$('exportBtn').disabled=true;$('resultContent').hidden=true;$('resultEmpty').hidden=false;$('messages').innerHTML='';const c=state.config,shift=c.origin==='before'?(Number(c.fill)||0):0;const gw=E.finite(c.water)?Number(c.water)+(c.waterDatum==='borehole'?shift:0):null;$('coordinateNote').textContent=`주상도 심도 가산: ${shift.toFixed(2)} m${gw!==null?' · 최종 지표면 기준 지하수위 GL(-) '+gw.toFixed(2)+' m':''}. 적용할 연중 최고지하수위를 사용하세요.`;if(shift>0)$('coordinateNote').textContent+=' 추가 성토층은 N=25/30을 적용합니다.';}
function renderTables(){
 state.layers=E.withAutoLayerTops(state.layers);
 state.layers=state.layers.map((l,i)=>({...l,soil:l.soil||'지층 '+(i+1)}));
 $('layersTable').tBodies[0].innerHTML=state.layers.map((l,i)=>`<tr data-i="${i}"><td>${i+1}구간${l.pageEnd?'<small style="display:block">이미지 하단 · 지층 계속</small>':l.estimated?'<small style="display:block">선 위치 추정</small>':''}</td><td><input type="text" data-key="soil" aria-label="${i+1}번 지층정보" placeholder="예: 점토섞인 실트, 풍화암" value="${esc(l.soil)}"></td><td><input aria-label="${i+1}번 지층 하단" type="number" min="0" step="0.1" data-key="bottom" placeholder="하단 심도 확인" value="${esc(l.bottom)}"></td><td><button class="remove" data-remove="layer" aria-label="지층 삭제">×</button></td></tr>`).join('');
 $('clayTable').tBodies[0].innerHTML=state.layers.map((l,i)=>`<tr data-i="${i}"><td>${esc(l.soil)||'지층 '+(i+1)}</td><td><input type="checkbox" data-key="clayConfirmed" aria-label="${i+1}번 점토거동 확인" ${l.clayConfirmed?'checked':''}></td>${['pi','ll','wc'].map(k=>`<td><input type="number" step="0.1" min="0" data-key="${k}" aria-label="${i+1}번 ${k}" value="${esc(l[k]??'')}"></td>`).join('')}</tr>`).join('');
 $('samplesTable').tBodies[0].innerHTML=state.samples.map((s,i)=>{const parts=E.sampleInputs(s),locked=s.depthLocked||String(s.source||'').startsWith('간격 자동 생성');if(locked)s.depthLocked=true;return `<tr data-i="${i}"><td>${locked?'<span class="fixed-depth" aria-label="자동 생성 심도 '+esc(s.depth)+' m · 수정 불가">'+esc(s.depth)+'</span>':'<input type="number" step="0.01" min="0" data-key="depth" aria-label="'+(i+1)+'번 측점 심도" value="'+esc(s.depth)+'">'}</td><td><input type="number" min="0" max="300" step="1" data-key="n" aria-label="${i+1}번 실측 N값" placeholder="예: 19" value="${esc(parts.n)}"></td><td><input type="number" min="0.01" max="30" step="0.01" data-key="penetration" aria-label="${i+1}번 관입량 cm" placeholder="cm" value="${esc(parts.penetration)}"></td><td>${esc(s.source||'직접 입력')}</td><td><button class="remove" data-remove="sample" aria-label="측점 삭제">×</button></td></tr>`}).join('');
 $('sampleCount').textContent=state.samples.length+'개';$('emptySamples').hidden=!!state.samples.length;
}
function wireTable(id,key){
 $(id).addEventListener('input',e=>{
  const el=e.target;if(!el.dataset.key)return;const i=Number(el.closest('tr').dataset.i);
  if(key==='samples'&&['n','penetration'].includes(el.dataset.key)){
   state.samples[i]=E.editSampleInput(state.samples[i],el.dataset.key,el.value);
   if(el.dataset.key==='n')el.closest('tr').querySelector('[data-key="penetration"]').value=state.samples[i].penetration;
  }else if(!(key==='samples'&&el.dataset.key==='depth'&&state.samples[i].depthLocked)){
   state[key][i][el.dataset.key]=el.type==='checkbox'?el.checked:el.value;
  }
  if(key==='layers')state.layers=E.withAutoLayerTops(state.layers);dirty();
 });
 $(id).addEventListener('click',e=>{if(e.target.dataset.remove){state[key].splice(+e.target.closest('tr').dataset.i,1);renderTables();dirty();}});
}
wireTable('layersTable','layers');wireTable('clayTable','layers');wireTable('samplesTable','samples');
for(const id of ['project','hole','water','fill','origin','waterDatum','imageStart','imageEnd','imageBasis'])$(id).addEventListener('input',()=>{readConfig();dirty();});
function syncImageAuto(){for(const id of ['imageStart','imageEnd'])$(id).readOnly=$('imageAuto').checked;}
$('imageAuto').onchange=()=>{readConfig();syncImageAuto();dirty();};
$('clearLayers').onclick=()=>{state.layers=[];renderTables();dirty();status('지층을 전체 삭제했습니다.');};
$('clearSamples').onclick=()=>{state.samples=[];renderTables();dirty();status('측점을 전체 삭제했습니다.');};
$('generateSamples').onclick=()=>{try{state.samples=E.addIntervalSamples(state.samples,$('sampleSpacing').value,+$('sampleSlots').value);renderTables();dirty();status('선택 간격의 측점을 추가했습니다. 기존 입력값은 유지하며 N값이 빈 측점은 평가에서 제외합니다.');}catch(e){status(e.message,true)}};
$('addLayer').onclick=()=>{state.layers.push({top:state.layers.at(-1)?.bottom||0,bottom:'',soil:'지층 '+(state.layers.length+1),clayConfirmed:false});renderTables();dirty();};
$('addSample').onclick=()=>{if(state.samples.length>=50)return status('측점은 최대 50개입니다.',true);state.samples.push({depth:'',n:'',source:'직접 입력'});renderTables();dirty();};
$('guideBtn').onclick=()=>$('guide').showModal();$('closeGuide').onclick=()=>$('guide').close();
function download(blob,name){const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),30000);}
$('saveBtn').onclick=()=>{readConfig();download(new Blob([JSON.stringify({version:1,...state,rawText:$('rawText').value},null,2)],{type:'application/json'}),(state.config.project||'액상화예비평가')+'_작업.json');status('작업을 저장했습니다. 원본 주상도 파일은 다시 첨부할 수 있습니다.');};
$('loadBtn').onclick=()=>$('projectFile').click();
$('projectFile').onchange=async e=>{try{const f=e.target.files[0];if(!f)return;const d=JSON.parse(await f.text());if(d.version!==1||!d.config||!Array.isArray(d.samples)||!Array.isArray(d.layers)||d.samples.length>1000||d.layers.length>200)throw new Error('지원하지 않는 작업파일입니다.');state={config:d.config,layers:d.layers,samples:d.samples};pages=[];active=-1;await refreshPages();applyConfig();renderTables();dirty();$('rawText').value=d.rawText||'';status('작업을 불러왔습니다. 원본은 별도로 첨부하세요.');}catch(e){status(e.message,true)}finally{e.target.value=''}};
async function imageFromFile(file){const url=URL.createObjectURL(file);try{const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new Error('이미지 읽기 실패'));i.src=url;});const scale=Math.max(1,Math.min(3,1800/img.width));const c=document.createElement('canvas');c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);if(c.width*c.height>35000000)throw new Error('이미지 크기가 너무 큽니다. 해상도를 낮춰주세요.');c.getContext('2d').drawImage(img,0,0,c.width,c.height);return c;}finally{URL.revokeObjectURL(url)}}
async function loadFiles(files){
 if(busy)return;if(files.length!==1)return status('현재는 이미지 한 장 또는 한 페이지 PDF만 지원합니다.',true);setBusy(true);try{
  pages=[];active=-1;const firstNew=0;
  for(const file of files){
   if(file.size>30*1024*1024)throw new Error(`${file.name}: 파일당 30 MB 이하로 첨부하세요.`);
   if(/\.pdf$/i.test(file.name)||file.type==='application/pdf'){
    status(file.name+' 읽는 중…');const pdf=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false}).promise;
    if(pdf.numPages!==1)throw new Error('현재는 한 페이지 PDF만 지원합니다. 사용할 한 장만 추출해 첨부하세요.');
    for(let n=1;n<=pdf.numPages;n++){
     const pg=await pdf.getPage(n),vp=pg.getViewport({scale:Math.min(3,1800/pg.getViewport({scale:1}).width)}),c=document.createElement('canvas');c.width=vp.width;c.height=vp.height;
     await pg.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
     const content=await pg.getTextContent();const words=content.items.filter(t=>t.str.trim()).map(t=>{const xy=pdfjs.Util.transform(vp.transform,t.transform),h=Math.max(8,Math.hypot(xy[2],xy[3]));return {text:t.str,bbox:{x0:xy[4],y0:xy[5]-h,x1:xy[4]+t.width*vp.scale,y1:xy[5]}}});
     pages.push({name:file.name+' · '+n+'쪽',canvas:c,words,text:wordsToText(words),source:file.name});
    }
   }else if(file.type.startsWith('image/'))pages.push({name:file.name,canvas:await imageFromFile(file),words:[],text:'',source:file.name});
   else throw new Error('PDF 또는 PNG·JPG·WEBP 이미지를 첨부하세요.');
  }
  if(pages.length){active=firstNew;await refreshPages();status('페이지가 준비되었습니다. 다른 시추공은 ‘새 시추공 평가’로 구분하세요.');dirty();}
 }catch(e){status('첨부 오류: '+e.message,true)}finally{setBusy(false);$('boreholeFile').value='';}
}
$('boreholeFile').onchange=e=>loadFiles([...e.target.files]);
for(const name of ['dragover','dragleave','drop'])$('dropzone').addEventListener(name,e=>{e.preventDefault();$('dropzone').classList.toggle('dragging',name==='dragover');if(name==='drop')loadFiles([...e.dataTransfer.files]);});
async function refreshPages(){
 $('pageSelect').innerHTML=pages.length?pages.map((p,i)=>`<option value="${i}">${esc(p.name)}</option>`).join(''):'<option>첨부된 페이지 없음</option>';
 $('pageSelect').value=active>=0?active:'';$('extractBtn').disabled=active<0||busy;
 $('emptyPreview').hidden=active>=0;$('emptyPreview').style.display=active>=0?'none':'flex';$('viewer').hidden=active<0;$('overlay').hidden=true;regions={geology:active>=0?pages[active].geometryBox||null:null};dragMode=null;
 if(active>=0){const src=pages[active].canvas,v=$('viewer');v.width=src.width;v.height=src.height;v.getContext('2d').drawImage(src,0,0);$('rawText').value=pages[active].text||'';}
 drawRegions();
}
$('pageSelect').onchange=async e=>{active=+e.target.value;await refreshPages();};
function wordsToText(words){const lines=[];for(const w of [...words].sort((a,b)=>a.bbox.y0-b.bbox.y0||a.bbox.x0-b.bbox.x0)){let l=lines.find(l=>Math.abs(l.y-w.bbox.y0)<Math.max(7,(w.bbox.y1-w.bbox.y0)*.5));if(!l){l={y:w.bbox.y0,words:[]};lines.push(l)}l.words.push(w)}return lines.sort((a,b)=>a.y-b.y).map(l=>l.words.sort((a,b)=>a.bbox.x0-b.bbox.x0).map(w=>w.text).join(' ')).join('\n');}
async function getWorker(){
 if(!worker){const base=new URL('./vendor/',import.meta.url).href;worker=await Tesseract.createWorker('kor+eng',1,{workerPath:base+'worker.min.js',corePath:base+'tesseract-core-lstm.wasm.js',langPath:base,gzip:true,workerBlobURL:false,logger:m=>{if(m.status)status('문자인식 · '+m.status+(m.progress!==undefined?' '+Math.round(m.progress*100)+'%':''));}});}
 return worker;
}
function autoSamples(words,width){
 const fractions=words.filter(w=>/\d\s*\/\s*\d/.test(w.text)&&w.bbox.x0>width*.50),out=[];
 for(const w of fractions){
  const m=w.text.replace(/[／⁄]/g,'/').match(/(\d{1,3})\s*\/\s*(\d{1,2})/);if(!m)continue;const p=E.parseN(m[0]);if(!p.valid)continue;
  const y=(w.bbox.y0+w.bbox.y1)/2,h=w.bbox.y1-w.bbox.y0;
  const choices=words.filter(a=>/^\d{1,3}(?:\.\d{1,2})?$/.test(a.text.trim())&&a.bbox.x1<=w.bbox.x0&&w.bbox.x0-a.bbox.x1<width*.13&&Math.abs((a.bbox.y0+a.bbox.y1)/2-y)<Math.max(9,h*1.6));
  choices.sort((a,b)=>(Math.abs((a.bbox.y0+a.bbox.y1)/2-y)*4+w.bbox.x0-a.bbox.x1)-(Math.abs((b.bbox.y0+b.bbox.y1)/2-y)*4+w.bbox.x0-b.bbox.x1));
  if(choices[0]&&+choices[0].text>0)out.push({depth:+choices[0].text,n:`${p.n}/${p.penetration}`,source:'자동 인식 후보'});
 }
 return out;
}
function detectedHole(text){return String(text).match(/\b((?:NBH|BH|BB|SB|CB|HB|DB|B)\s*[-−]\s*\d+(?:\s*[-−]\s*\d+){0,2})\b/i)?.[1]?.replace(/\s/g,'').replace(/−/g,'-').toUpperCase()||'';}
function guardHole(text=''){
 const hole=detectedHole(text)||detectedHole(pages[active]?.source||'');
 if(hole&&state.config.hole&&hole!==state.config.hole.toUpperCase())throw new Error(`현재 ${state.config.hole}와 다른 시추공 ${hole}입니다. ‘선택한 페이지로 새 시추공 평가’를 눌러 구분하세요.`);
 if(hole&&!state.config.hole){state.config.hole=hole;applyConfig();}
}
$('newHoleBtn').onclick=()=>{if(busy)return;if(active<0)return status('먼저 주상도를 첨부하세요.',true);state.layers=[];state.samples=[];state.config.hole=detectedHole(pages[active].source)||detectedHole(pages[active].text);applyConfig();renderTables();dirty();status('지층·측점을 초기화했습니다. 선택한 시추공의 페이지를 읽으세요.');};
function mergeCandidates(candidates){
 readConfig();
 const autoFields=[];
 for(const [key,value] of Object.entries(candidates.config||{})){
  if(key==='waterDatum')continue;
  if(state.config[key]===''||state.config[key]===null||state.config[key]===undefined||(key==='fill'&&+state.config.fill===0)){
   state.config[key]=value;autoFields.push({project:'구조물명',hole:'시추공명',water:'지하수위',fill:'성토고'}[key]||key);
   if(key==='water')state.config.waterDatum=candidates.config.waterDatum||'borehole';
  }
 }
 applyConfig();
 const note=$('autoReadNote');
 if(candidates.config||candidates.layers?.length)note.textContent='자동 입력 후보 · '+(autoFields.length?autoFields.join(', ')+' 입력. ':'기존 평가조건 유지. ')+(candidates.notes||[]).join(' ')+' 지층 경계·지하수위·성토고·심도 기준면을 원본과 대조하여 수정하세요. 읽히지 않은 항목은 직접 입력하세요.';
 let added=0,conflicts=0;
 for(const original of candidates.samples||[]){const s={...original,n:E.normalizeAutoN(original.n)};const existing=state.samples.find(t=>Math.abs(+t.depth-+s.depth)<1e-6);if(existing){if(!String(existing.n??'').trim()){Object.assign(existing,s);added++;}else if(E.parseN(existing.n).raw!==E.parseN(s.n).raw)conflicts++;}else if(state.samples.length<50){state.samples.push({...s,source:s.source||'인식 후보'});added++;}}
 state.samples.sort((a,b)=>+a.depth-+b.depth);
 let layerAdded=0;for(const l of candidates.layers||[]){if(!state.layers.some(x=>Math.abs(+x.top-l.top)<1e-6&&Math.abs(+x.bottom-l.bottom)<1e-6)){if(Math.abs(+l.top-(+state.layers.at(-1)?.bottom||0))<1e-6){state.layers.push(l);layerAdded++;}else{conflicts++;}}}
 if(!state.layers.length&&candidates.layerDrafts?.length){state.layers=E.withAutoLayerTops(candidates.layerDrafts);layerAdded=candidates.layerDrafts.length;}
 state.layers.sort((a,b)=>+a.top-+b.top);renderTables();dirty();
 status(`측점 후보 ${added}개 · 지층 후보 ${layerAdded}개 추가. ${conflicts?`동일 심도에서 다른 N값 ${conflicts}건: 기존값을 유지했으므로 원본을 확인하세요. `:''}${!added?'SPT 시험값은 직접 입력하세요. ':''}인식값을 원본과 대조하세요. ${candidates.layerNotice||''}`);
}
async function extract(){
 if(busy||active<0)return;readConfig();
 if(!state.config.imageAuto&&(!E.finite(state.config.imageStart)||!E.finite(state.config.imageEnd)||+state.config.imageEnd<=+state.config.imageStart))return status('이미지 시작 심도와 끝 심도를 입력하세요. 끝 심도는 시작 심도보다 커야 합니다.',true);
 if(pages.length!==1)return status('현재는 주상도 첫 장만 해석합니다. 첫 장의 이미지를 첨부하세요.',true);
 if(!state.config.imageAuto&&Number(state.config.imageStart)>0)return status('현재는 0 m에서 시작하는 첫 장만 해석합니다. 이어지는 둘째 장 이후는 제외하고 첫 장을 첨부하세요.',true);
 setBusy(true);
 try{
  const pg=pages[active];guardHole(pg.text);
  if(state.config.imageAuto){status('심도 눈금과 현장관찰기록을 대조하는 중…');const inferred=await inferImageRange(pg);pg.autoRange=inferred;if(inferred.error){$('autoReadNote').textContent=inferred.error;status(inferred.error,true);return;}state.config.imageStart=inferred.start;state.config.imageEnd=inferred.end;applyConfig();}
  status('시작선·끝선과 지층 경계선 분석 중…');
  const geometry=buildRange(pg);pg.geometry=geometry;populateRangeOptions(pg);drawRegions();
  if(geometry.error){$('autoReadNote').textContent=geometry.error+' 기준선 보정에서 후보를 바꾸거나 하단 심도를 직접 입력하세요.';status(geometry.error,true);return;}
  if(pg.headerText===undefined){try{const r=await PrecheckOCR.region(await getWorker(),pg.canvas,[0,.05,1,.30],false);pg.headerText=r.text;}catch{pg.headerText='';}}
  const text=pg.text+'\n'+pg.headerText+'\n'+(pg.depthEvidence?.text||'');guardHole(text);const meta=E.documentInfo(text);
  mergeCandidates({config:meta.config,notes:meta.notes});$('rawText').value=text;
  const prefix=geometry.start>0?[{bottom:geometry.start,soil:'상부 자료 미확인',clayConfirmed:false,unmeasured:true}]:[];
  state.layers=E.withAutoLayerTops([...prefix,...geometry.boundaries.map((b,i)=>({bottom:b.depth,soil:'지층 '+(i+1),clayConfirmed:false,estimated:true,pageEnd:!!b.pageEnd}))]);
  renderTables();dirty();drawRegions();
  const sampleNotice=await createSampleRows(pg,geometry);
  const observationNotice=geometry.observationWarning?' 관찰기록 교차확인 경고: '+geometry.observationWarning+' 눈금과 이미지 경계를 기준으로 만든 후보를 원본과 확인하세요.':'';
  const note=(state.config.imageAuto?'자동 범위: '+pg.autoRange.source+' · ':'수동 범위 · ')+(geometry.rulerAnchors?'국부 눈금 '+geometry.rulerAnchors+'개로 보정 · ':'시작·끝선 비례 추정 · ')+'입력 범위 '+geometry.start+'~'+geometry.end+' m · 하단 후보 '+geometry.boundaries.map(b=>b.depth+' m').join(', ')+'. 파란 시작선·끝선이 입력 심도 위치와 일치하는지 확인하세요. 선이 다르면 기준선 보정에서 후보를 바꾸세요.';
  $('autoReadNote').textContent=note+sampleNotice+observationNotice;status(note+sampleNotice+observationNotice+(geometry.continued?' 마지막 행은 현재 이미지 하단이며 지층이 다음 장으로 이어집니다.':'')+' SPT 값은 자동 생성·변경하지 않습니다.');
 }catch(e){status('경계 읽기 실패: '+e.message,true);}finally{setBusy(false);}
}
async function createSampleRows(pg,geometry){
 status('관입시험 측점을 확인하는 중…');
 try{
  if(!pg.sampleRows||pg.sampleGeometryKey!==[geometry.top,geometry.bottom,geometry.start,geometry.end].join(':')){
   const detected=await PrecheckOCR.sampleRows(await getWorker(),pg.canvas,geometry);
   pg.sampleGeometryKey=[geometry.top,geometry.bottom,geometry.start,geometry.end].join(':');
   pg.sampleRows=detected.samples.filter(s=>Number.isFinite(+s.depth)&&+s.depth>0&&+s.depth<=+geometry.end+.05);
  }
  const depths=[...new Set(pg.sampleRows.map(s=>+s.depth))].sort((a,b)=>a-b);
  if(depths.length)state.samples=state.samples.filter(s=>s.source!=='주상도 측점 후보 · 심도 확인'||String(s.n??'').trim()||String(s.penetration??'').trim());
  let added=0;
  for(const depth of depths){
   if(state.samples.some(s=>E.finite(s.depth)&&Math.abs(+s.depth-depth)<.01))continue;
   if(state.samples.length>=50)break;
   state.samples.push({depth,n:'',penetration:'',source:'주상도 측점 후보 · 심도 확인'});added++;
  }
  state.samples.sort((a,b)=>+a.depth-+b.depth);
  if(depths.length)$('sampleSlots').value=depths.length;
  renderTables();dirty();
  return depths.length?' 관입시험 측점 후보 '+depths.length+'개를 확인해 빈 입력 행 '+added+'개를 추가했습니다. 심도·개수를 원본과 확인하고 N값·관입량을 입력하세요.':' 관입시험 측점을 확인하지 못했습니다. 측점 간격·생성 개수로 입력 행을 추가하세요.';
 }catch(e){return ' 측점 자동 확인에 실패했습니다. 측점 간격·생성 개수로 입력 행을 추가하세요.';}
}
async function inferImageRange(pg){
 const c=pg.canvas,w=c.width,h=c.height;
 if(!pg.rangePixels)pg.rangePixels=c.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data;
 const found=DepthGeometry.findRange(pg.rangePixels,w,h,'table');
 let columns=AutoDepth.layout(pg.words,w,h,found);
 const recognize=async(box,numeric,retry=false)=>{
  const [x,y,x1,y1]=box.map((v,i)=>Math.round(v*(i%2?h:w))),scale=retry?Math.min(2,3200/Math.max(x1-x,y1-y)):1,pad=20;
  const crop=document.createElement('canvas');crop.width=Math.round((x1-x)*scale)+pad*2;crop.height=Math.round((y1-y)*scale)+pad*2;
  const cx=crop.getContext('2d',{willReadFrequently:true});cx.fillStyle='white';cx.fillRect(0,0,crop.width,crop.height);cx.drawImage(c,x,y,x1-x,y1-y,pad,pad,(x1-x)*scale,(y1-y)*scale);
  if(retry){const data=cx.getImageData(0,0,crop.width,crop.height);for(let i=0;i<data.data.length;i+=4){const v=data.data[i]*.299+data.data[i+1]*.587+data.data[i+2]*.114;const q=v<165?0:255;data.data[i]=data.data[i+1]=data.data[i+2]=q;}cx.putImageData(data,0,0);}
  const worker=await getWorker();await worker.setParameters({tessedit_pageseg_mode:numeric?(retry?'6':'11'):(retry?'11':'6'),tessedit_char_whitelist:numeric?'0123456789. ':''});
  const r=await worker.recognize(crop,{}, {blocks:true}),words=r.data.words||r.data.blocks?.flatMap(b=>b.paragraphs.flatMap(p=>p.lines.flatMap(l=>l.words)))||[];
  return {text:r.data.text,words:words.map(v=>({...v,bbox:{x0:(v.bbox.x0-pad)/scale+x,x1:(v.bbox.x1-pad)/scale+x,y0:(v.bbox.y0-pad)/scale+y,y1:(v.bbox.y1-pad)/scale+y}}))};
 };
 if(!pg.depthEvidence){
  if(!pg.layoutWords){try{const header=await recognize([0,.08,1,.40],false);pg.layoutWords=header.words;pg.headerText=header.text;columns=AutoDepth.layout([...(pg.words||[]),...header.words],w,h,found);}catch{pg.layoutWords=[];}}
  if(columns.multipleLogs)return {error:'한 이미지 안에 주상도가 여러 개 있습니다. 주상도 하나만 잘라서 첨부하세요.'};
  const left=await recognize([.015,.21,.17,.97],true),obs=await recognize([.25,.30,.54,.96],false),baseText=(pg.text||'')+'\n'+(pg.headerText||'')+'\n'+obs.text,base=AutoDepth.infer({found,fit:DepthGeometry.fitRuler(left.words,w,h),text:baseText,basis:state.config.imageBasis});
  if(!base.error){const g=AutoDepth.reconcile(DepthGeometry.fromRange(pg.rangePixels,w,h,{...base,basis:state.config.imageBasis,found,top:base.correctedTop}),baseText);if(!g.error){pg.depthEvidence={words:left.words,text:baseText,extraFits:[],columns};return base;}}
  let rulerWords=(pg.words||[]).filter(v=>v.bbox.x1<w*.18),text=pg.text||'';
  if(!DepthGeometry.fitRuler(rulerWords,w,h)){const r=await recognize(columns.ruler,true);rulerWords=r.words;}
  try{const r=await recognize(columns.observation,false);text+='\n'+r.text;}catch{}
  const extraFits=[];
  if(columns.right){try{const r=await recognize(columns.right,true),fit=DepthGeometry.fitRuler(r.words,w,h);if(fit)extraFits.push(fit);}catch{}}
  pg.depthEvidence={words:rulerWords,text,extraFits,columns};
 }
 const evidence=pg.depthEvidence,solve=()=>AutoDepth.infer({found,fit:DepthGeometry.fitRuler(evidence.words,w,h),extraFits:evidence.extraFits,text:evidence.text,basis:state.config.imageBasis});
 let result=solve();
 if(result.error&&!evidence.retried){
  status('심도 정보 재확인 중 · 확대·대비 보정 및 다른 문자 배치 방식으로 다시 읽습니다.');
  evidence.retried=true;
  try{const r=await recognize(columns.ruler,true,true);evidence.words.push(...r.words);}catch{}
  try{const b=columns.observation,r=await recognize([Math.max(.1,b[0]-.06),Math.max(.15,b[1]-.03),Math.min(.92,b[2]+.12),.97],false,true);evidence.text+='\n'+r.text;}catch{}
  result=solve();
 }
 return result;
}
function buildRange(pg){
 const src=pg.canvas;
 if(!pg.rangePixels)pg.rangePixels=src.getContext('2d',{willReadFrequently:true}).getImageData(0,0,src.width,src.height).data;
 if(!pg.rangeFound)pg.rangeFound=DepthGeometry.findRange(pg.rangePixels,src.width,src.height,state.config.imageBasis||'table');
 const found=pg.rangeFound,top=pg.rangeTopIndex&&pg.rangeTopIndex!=='auto'?found.lines[+pg.rangeTopIndex]:(state.config.imageAuto?pg.autoRange?.correctedTop:undefined),bottom=pg.rangeBottomIndex&&pg.rangeBottomIndex!=='auto'?found.lines[+pg.rangeBottomIndex]:undefined;
 const g=DepthGeometry.fromRange(pg.rangePixels,src.width,src.height,{start:state.config.imageStart,end:state.config.imageEnd,basis:state.config.imageBasis,found,top,bottom});
 return state.config.imageAuto&&pg.depthEvidence?AutoDepth.reconcile(g,pg.depthEvidence.text):g;
}
function populateRangeOptions(pg){
 for(const [id,key,label] of [['rangeTopLine','rangeTopIndex','자동 시작선'],['rangeBottomLine','rangeBottomIndex','자동 끝선']]){
  $(id).innerHTML='<option value="auto">'+label+'</option>'+(pg.rangeFound?.lines||[]).map((y,i)=>'<option value="'+i+'">가로선 후보 '+(i+1)+' · 위에서 '+(y/pg.canvas.height*100).toFixed(1)+'%</option>').join('');
  $(id).value=pg[key]||'auto';
 }
}
function drawRegions(){
 const v=$('viewer'),o=$('overlay');o.width=v.width;o.height=v.height;o.style.width=v.clientWidth+'px';o.style.height=v.clientHeight+'px';
 const ctx=o.getContext('2d');ctx.clearRect(0,0,o.width,o.height);const g=pages[active]?.geometry;
 ctx.lineWidth=Math.max(2,v.width/450);ctx.font=Math.max(15,v.width/65)+'px sans-serif';
 if(g&&!g.error){
  for(const b of g.boundaries){ctx.strokeStyle='#d38320';ctx.fillStyle='#b36507';ctx.beginPath();ctx.moveTo(g.box?.x||v.width*.1,b.y);ctx.lineTo(v.width*.52,b.y);ctx.stroke();ctx.fillText(b.depth+' m (추정)',v.width*.53,b.y-5);}
  for(const [y,label] of [[g.top,'시작 '+g.start+' m'],[g.bottom,'끝 '+g.end+' m']]){ctx.strokeStyle='#247ab0';ctx.fillStyle='#247ab0';ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(v.width,y);ctx.stroke();ctx.fillText(label,v.width*.55,y-5);}
 }
 o.hidden=!(active>=0&&g&&!g.error);o.style.pointerEvents='none';
}

$('extractBtn').onclick=extract;
$('parseTextBtn').onclick=()=>{const p=E.parseText($('rawText').value);mergeCandidates({...p,samples:[]});};
$('cropOCR').onclick=extract;
$('clearROI').onclick=()=>{if(active<0)return;const pg=pages[active];pg.rangeTopIndex='auto';pg.rangeBottomIndex='auto';pg.rangeFound=null;pg.geometry=null;populateRangeOptions(pg);drawRegions();dirty();status('기준선 선택을 자동으로 되돌렸습니다. 현재 페이지 읽기를 누르세요.');};
for(const [id,key] of [['rangeTopLine','rangeTopIndex'],['rangeBottomLine','rangeBottomIndex']])$(id).onchange=()=>{if(active<0)return;pages[active][key]=$(id).value;readConfig();pages[active].geometry=buildRange(pages[active]);drawRegions();dirty();status('기준선 위치를 바꿨습니다. 파란 선을 확인한 뒤 경계 다시 읽기를 누르세요.');};
$('imageBasis').addEventListener('change',()=>{if(active<0)return;const pg=pages[active];pg.rangeFound=null;pg.rangeTopIndex='auto';pg.rangeBottomIndex='auto';pg.geometry=null;populateRangeOptions(pg);drawRegions();});
window.addEventListener('resize',()=>{if(active>=0)drawRegions()});
function showResult(){
 readConfig();const r=E.evaluate(state);const skipped=state.samples.filter(s=>!String(s.n??'').trim()).length;if(skipped)r.warnings.push('시험값 미입력 측점 '+skipped+'개는 평가에서 제외했습니다.');currentResult=r;$('reviewed').checked=false;$('exportBtn').disabled=true;
 $('messages').innerHTML=[...r.errors.map(t=>`<div class="message error">${esc(t)}</div>`),...r.warnings.map(t=>`<div class="message">${esc(t)}</div>`)].join('');
 if(r.errors.length){$('resultContent').hidden=true;$('resultEmpty').hidden=true;return}
 $('resultContent').hidden=false;$('resultEmpty').hidden=true;$('summaryText').textContent=r.summary;$('summaryDetail').textContent=`최종 지표면 기준 0~${r.end.toFixed(2)} m · 지하수위 GL(-) ${r.gw.toFixed(2)} m${r.counts.pending?' · 자료 미확인 구간 포함':''}`;
 for(const [id,key] of [['omitCount','omit'],['needCount','need'],['pendingCount','pending']])$(id).textContent=r.counts[key];
 $('resultRows').innerHTML=r.rows.map(row=>`<tr><td>${row.top.toFixed(2)} ~ ${row.bottom.toFixed(2)}</td><td>${esc(row.soil)}</td><td>${row.thickness.toFixed(2)}</td><td>${esc(row.nText)}${row.assumedFill?'<small style="display:block">성토층 적용값</small>':''}${row.carried?'<small style="display:block">심도 '+row.sourceDepth+' m 값 적용</small>':''}</td><td><span class="badge ${row.status==='본평가 필요'?'need':row.status==='자료확인 필요'?'pending':''}">${row.status}</span></td><td>${esc(row.reason)}</td></tr>`).join('');
}
$('calculateBtn').onclick=showResult;
$('reviewed').onchange=()=>{$('exportBtn').disabled=!$('reviewed').checked||!currentResult||currentResult.errors.length>0;};
$('exportBtn').onclick=async()=>{if(!currentResult||!$('reviewed').checked)return;$('exportBtn').disabled=true;try{await window.LiquefactionExport.generate(state,currentResult,pages);status('엑셀 계산서를 생성했습니다.');}catch(e){status('엑셀 생성 실패: '+e.message,true)}finally{$('exportBtn').disabled=!$('reviewed').checked}};
$('demoBtn').onclick=async()=>{
 if(busy)return;const example=$('demoSelect').value;
 if(example!=='base'){try{const r=await fetch('./examples/'+encodeURIComponent(example)+'.json');if(!r.ok)throw Error('예제 읽기 실패');const d=await r.json();state={config:d.config,layers:d.layers,samples:d.samples};pages=[];active=-1;await refreshPages();applyConfig();renderTables();dirty();$('rawText').value=d.rawText||'';status('원본을 대조하여 정리한 입력 예제입니다. 적용 지하수위와 성토고를 입력한 뒤 평가하세요. 자동 OCR 결과와 구분됩니다.');}catch(e){status(e.message,true)}return;}
 state=E.demo();applyConfig();renderTables();dirty();pages=[];active=-1;try{const r=await fetch('./demo-borehole.png');if(r.ok){const f=new File([await r.blob()],'예제_BB-89_첫페이지.png',{type:'image/png'});pages=[{name:f.name,source:f.name,canvas:await imageFromFile(f),words:[],text:''}];active=0;}}catch{}await refreshPages();showResult();status('첨부 주상도 첫 페이지의 실측자료 예제입니다. 원본 시트에 가정 입력된 성토층 N값은 사용하지 않았습니다.');};
// QA surface contains only the same pure domain engine used by the interface.
window.precheckApp={getState:()=>structuredClone(state),getResult:()=>currentResult};
applyConfig();renderTables();dirty();
