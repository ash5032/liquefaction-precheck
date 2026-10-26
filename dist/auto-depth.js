(function(root){
function ranges(text){const out=[];for(const line of String(text).normalize('NFKC').split(/\n/)){const s=line.replace(/(\d)\s*[,.]\s*(\d)/g,'$1.$2');const re=/(\d{1,3}(?:\.\d{1,2})?)\s*[mM]?\s*[-~∼〜–—]\s*(\d{1,3}(?:\.\d{1,2})?)/g;let m;while((m=re.exec(s))){const a=+m[1],b=+m[2];if(a>=0&&b>a&&b<=100)out.push({top:a,bottom:b});}}return out;}
function chainOf(items){let best=[];for(const p of items){if(Math.abs(p.top)>.05)continue;const chain=[p];for(const q of items){if(Math.abs(q.top-chain.at(-1).bottom)<.06&&q.bottom>chain.at(-1).bottom)chain.push(q);}if(chain.length>best.length)best=chain;}return best;}
function layout(words,w,h,found){
 const titles=(words||[]).filter(p=>p.bbox&&/^DRILL$/i.test(String(p.text).trim())&&(words||[]).some(q=>q.bbox&&/^LOG$/i.test(String(q.text).trim())&&q.bbox.x0>=p.bbox.x1-w*.01&&q.bbox.x0-p.bbox.x1<w*.12&&Math.abs(q.bbox.y0-p.bbox.y0)<h*.015));
 const multipleLogs=titles.some((a,i)=>titles.slice(i+1).some(b=>Math.abs(a.bbox.x0-b.bbox.x0)>w*.18||Math.abs(a.bbox.y0-b.bbox.y0)>h*.18));
 const head=(words||[]).filter(p=>p.bbox&&p.bbox.y0<h*.40),center=p=>(p.bbox.x0+p.bbox.x1)/2/w;
 const find=re=>head.find(p=>re.test(String(p.text).replace(/\s/g,'')));
 const depth=find(/^(심도|DEPTH)$/i),obs=find(/관찰|DESCRIPTION|DESCRIPTIONS/i),sample=find(/시료|SAMPLE/i);
 const y=Math.max(.16,Math.min(.40,(found?.top||h*.25)/h-.025));
 const ruler=depth&&center(depth)<.3?[Math.max(0,center(depth)-.05),y,Math.min(.30,center(depth)+.05),.97]:[.015,.21,.17,.97];
 const observation=obs?[Math.max(.12,center(obs)-.16),y,Math.min(.85,center(obs)+.17),.97]:[.25,.30,.54,.96];
 const right=sample&&center(sample)>.45?[Math.max(.4,center(sample)-.06),y,Math.min(.97,center(sample)+.06),.97]:null;
 return {ruler,observation,right,headerLocated:!!(depth||obs||sample),multipleLogs};
}
function reconcile(geometry,text){
 if(!geometry||geometry.error)return geometry;
 const chain=chainOf(ranges(text)),end=geometry.end,expected=chain.map(p=>Math.round(p.bottom*10)/10).filter(d=>d<=end+.05),actual=geometry.boundaries.filter(p=>!p.pageEnd);
 if(chain.length>=3&&Math.abs(chain.at(-1).bottom-end)<.05&&expected.length===actual.length+1&&actual.every((b,i)=>Math.abs(b.depth-expected[i])<=.25)){
  const b={depth:end,y:geometry.bottom,estimated:true};geometry.boundaries.push(b);actual.push(b);
 }
 // Only use a complete, ordered one-to-one match. Partial OCR must not delete boundaries.
 if(expected.length>=3&&expected.length===actual.length&&expected.every((d,i)=>Math.abs(d-actual[i].depth)<=.25)){
  actual.forEach((b,i)=>{if(b.depth!==expected[i])b.observationCorrected=true;b.depth=expected[i];});
  geometry.observationMatched=true;
 }
 if(chain.length>=3&&expected.length>=2&&!geometry.observationMatched)return {...geometry,error:'현장관찰기록의 연속 구간과 지층 경계선이 일치하지 않습니다. 자동 결과를 원본과 대조하고 기준선을 확인하세요.'};
 if(!geometry.observationMatched){
  for(const p of chain){
   if(p.bottom>end+.05)continue;
   if(![geometry.start,...actual.map(b=>b.depth)].some(d=>Math.abs(d-p.top)<=.15))continue;
   if(actual.some(b=>b.depth>p.top+.15&&b.depth<p.bottom-.15))return {...geometry,error:'관찰기록상 하나의 지층 안에서 추가 경계선이 검출됐습니다. 원본과 기준선을 확인하세요.'};
   const b=actual.filter(b=>b.depth>p.top).sort((a,b)=>Math.abs(a.depth-p.bottom)-Math.abs(b.depth-p.bottom))[0];
   if(!b)continue;const delta=Math.abs(b.depth-p.bottom);
   if(delta>.15&&delta<.35)return {...geometry,error:'관찰기록 숫자와 지층 경계선 사이에 0.15 m를 넘는 차이가 있습니다. 원본을 확인하세요.'};
   if(delta<=.15&&Math.abs(p.bottom*10-Math.round(p.bottom*10))<.001){b.depth=p.bottom;b.observationCorrected=true;}
  }
 }
 const last=geometry.boundaries.at(-1)?.depth??geometry.start;
 if(ranges(text).some(p=>Math.abs(p.top-last)<=.25&&p.bottom>end+.3)&&last<end-.1){geometry.boundaries.push({depth:end,y:geometry.bottom,estimated:true,pageEnd:true});geometry.continued=true;}
 return geometry;
}
function infer({found,fit,extraFits=[],text,basis='table'}){
 if(/\b(?:DEPTH\s*\(?\s*(?:FT|FEET)|DEPTH\s*IN\s*FEET)\b/i.test(String(text)))return {error:'피트(ft) 단위 주상도입니다. m 단위로 확인·변환한 자료를 사용하세요.'};
 if(!found||!Number.isFinite(found.top)||!Number.isFinite(found.frame))return {error:'표의 시작선과 하단선을 확인하지 못했습니다.'};
 const top=found.top,frame=found.frame,lines=found.lines.filter(y=>y>top+4&&y<frame-8),candidates=[];
 if(fit&&fit.inliers.length>=5){const residual=fit.inliers.map(p=>Math.abs(p.y-fit.origin-p.depth*fit.scale)/fit.scale).sort((a,b)=>a-b);const startRaw=(top-fit.origin)/fit.scale,endRaw=(frame-fit.origin)/fit.scale,start=Math.max(0,Math.round(startRaw*2)/2),end=Math.round(endRaw*2)/2;
 if(residual[Math.floor(residual.length/2)]<.12&&Math.abs(startRaw-start)<.17&&Math.abs(endRaw-end)<.17&&start>=0&&end>start)candidates.push({start,end,origin:fit.origin,scale:fit.scale,source:'좌측 심도 숫자 '+fit.inliers.length+'개'});}
 const chain=chainOf(ranges(text));
 if(chain.length>=3&&chain.length===lines.length+1&&Math.abs(chain.at(-1).bottom*2-Math.round(chain.at(-1).bottom*2))<.01){
  const ds=chain.map(p=>p.bottom),ys=[...lines,frame],scale=(frame-top)/ds.at(-1);
  if(scale>0&&ds.every((d,i)=>Math.abs((ys[i]-top)/scale-d)<.13))candidates.push({start:0,end:ds.at(-1),origin:top,scale,source:'관찰기록과 표 하단의 일치 경계 '+chain.length+'개'});
 }
 if(chain.length>=3&&chain.length===lines.length){const values=chain.map(p=>p.bottom),slopes=values.map((d,i)=>(lines[i]-top)/d).sort((a,b)=>a-b),scale=slopes[Math.floor(slopes.length/2)],endRaw=(frame-top)/scale,end=Math.round(endRaw*2)/2;
 if(scale>0&&Math.abs(endRaw-end)<.17&&values.every((d,i)=>Math.abs((lines[i]-top)/scale-d)<.17))candidates.push({start:0,end,origin:top,scale,source:'현장관찰기록 '+chain.length+'개 연속 구간'});}
 if(chain.length>=3){
  const crossing=chain.length===lines.length+1,parts=crossing?chain.slice(0,-1):chain;
  if(parts.length>=3&&parts.length===lines.length){
   const xs=parts.map(p=>p.bottom),mx=xs.reduce((a,b)=>a+b,0)/xs.length,my=lines.reduce((a,b)=>a+b,0)/lines.length;
   const scale=xs.reduce((s,x,i)=>s+(x-mx)*(lines[i]-my),0)/xs.reduce((s,x)=>s+(x-mx)**2,0),origin=my-mx*scale,endRaw=(frame-origin)/scale,end=Math.round(endRaw*2)/2;
   if(scale>0&&Math.abs(origin-top)<Math.max(12,(frame-top)*.018)&&Math.abs(endRaw-end)<.18&&xs.every((x,i)=>Math.abs((lines[i]-origin)/scale-x)<.13)&&(!crossing||chain.at(-1).bottom>end+.3))candidates.push({start:0,end,origin,scale,correctedTop:origin,source:'현장관찰기록 '+parts.length+'개 경계 대조'+(crossing?' · 다음 장 연속 지층':'')});
  }
 }
 if(!candidates.length)return {error:'심도 숫자와 현장관찰기록에서 일관된 범위를 확인하지 못했습니다. 자동 추정을 끄고 시작·끝 심도를 입력하세요.',ranges:chain};
 if(candidates.length>1&&candidates.some(p=>Math.abs(p.start-candidates[0].start)>.2||Math.abs(p.end-candidates[0].end)>.2))return {error:'좌측 눈금과 현장관찰기록의 추정 범위가 다릅니다. 자동 추정을 끄고 원본 심도를 확인하세요.'};
 const c=candidates[0];
 for(const other of extraFits.filter(Boolean)){const a=(top-other.origin)/other.scale,b=(frame-other.origin)/other.scale;if(Math.abs(a-c.start)>.25||Math.abs(b-c.end)>.25)return {error:'좌측 눈금·관찰기록과 우측 심도 정보가 일치하지 않습니다. 원본 심도를 확인하세요.'};}
 if(c.start>0)return {error:'이어지는 페이지로 판단됩니다. 현재는 0 m에서 시작하는 첫 장만 해석합니다. 둘째 장 이후는 제외하고 첫 장을 첨부하세요.'};const boundaryDepths=[c.start,...lines.map(y=>(y-c.origin)/c.scale)];const matched=ranges(text).filter(p=>boundaryDepths.some(d=>Math.abs(d-p.top)<.18)&&boundaryDepths.some(d=>Math.abs(d-p.bottom)<.18)).length;let end=c.end;
 if(basis==='termination'){const y=lines.at(-1);if(!y)return {error:'시추종료선을 확인하지 못했습니다.'};end=Math.round(((y-c.origin)/c.scale)*10)/10;if(chain.length&&Math.abs(chain.at(-1).bottom-end)<.2)end=chain.at(-1).bottom;}
 return {start:c.start,end,tableEnd:c.end,correctedTop:c.correctedTop,source:candidates.map(p=>p.source).join(' + ')+(matched?' · 관찰기록 '+matched+'개 구간 대조':''),rangeCount:chain.length,matchedRanges:matched};
}
root.AutoDepth={ranges,chainOf,infer,layout,reconcile};if(typeof module!=='undefined')module.exports=root.AutoDepth;
})(typeof window!=='undefined'?window:globalThis);
