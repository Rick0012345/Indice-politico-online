export type IngestionPlanConfig = {
  from:string; to:string; datasets:string[]; window:'month'|'quarter'|'year'; resetEmpty?:boolean;
};
export type DatasetPlan = {dataset:string; entityIds:string[]; windows:Array<{start:string;end:string}>};

export const buildWindows = (from:string,to:string,mode:IngestionPlanConfig['window']) => {
  const step=mode==='year'?12:mode==='quarter'?3:1;
  const end=new Date(`${to}T00:00:00.000Z`);
  const windows:Array<{start:string;end:string}>=[];
  let cursor=new Date(`${from}T00:00:00.000Z`);
  while(cursor<=end){
    const next=new Date(Date.UTC(cursor.getUTCFullYear(),cursor.getUTCMonth()+step,1));
    const windowEnd=new Date(next);windowEnd.setUTCDate(windowEnd.getUTCDate()-1);
    windows.push({start:cursor.toISOString().slice(0,10),end:(windowEnd>end?end:windowEnd).toISOString().slice(0,10)});
    cursor=next;
  }
  return windows;
};

export const yearsForRange = (from:string,to:string) => {
  const start=new Date(`${from}T00:00:00.000Z`).getUTCFullYear();
  const end=new Date(`${to}T00:00:00.000Z`).getUTCFullYear();
  return Array.from({length:end-start+1},(_,index)=>start+index);
};

export const legislaturesForYears = (years:number[]) => {
  const ids=new Set<number>();
  for(const year of years){if(year>=2015&&year<=2018)ids.add(55);if(year>=2019&&year<=2022)ids.add(56);if(year>=2023&&year<=2026)ids.add(57);}
  return [...ids];
};

export const buildIngestionPlan = (config:IngestionPlanConfig,politicoIds:string[]):DatasetPlan[] =>
  [...new Set(config.datasets)].map(dataset=>({
    dataset,
    entityIds:dataset==='deputados'?legislaturesForYears(yearsForRange(config.from,config.to)).map(String):dataset==='despesas'?[...new Set(politicoIds)]:[''],
    windows:dataset==='despesas'?buildWindows(config.from,config.to,'month'):['votacoes','proposicoes','eventos'].includes(dataset)?buildWindows(config.from,config.to,config.window):[{start:config.from,end:config.to}],
  }));
