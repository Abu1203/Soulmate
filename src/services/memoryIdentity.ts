import type { MemoryNode } from '../types/memory';
/** Text normalization is for fact identity only, never emotion or relationship scoring. */
export function semanticText(text:string):string {
  return text.normalize('NFKC').toLowerCase().replace(/偏爱|喜爱|爱喝|喜欢喝|偏好/g,'喜欢').replace(/不加糖|不放糖|零糖/g,'无糖').replace(/热的咖啡/g,'热咖啡').replace(/居住在|现居于|现居|居住于|住在|搬到了|搬到|已搬到/g,'居住').replace(/[\s\p{P}\p{S}]/gu,'');
}
export function factIdentity(key:string|undefined,content:string):string|undefined {
  const k=(key||'').toLowerCase().replace(/[-\s]/g,'_');
  if(/^(user\.)?(home_city|city|residence|residence_city|living_city|address|location)$/.test(k))return 'user.home_city';
  if(/^(user\.)?(coffee|coffee_preference|coffee_sugar|drink\.coffee|preferences\.coffee)$/.test(k))return 'user.preference.coffee';
  if(/用户/.test(content)&&/(居住|住在|现居|搬到|搬家至)/.test(content)&&!/工作|公司|上班/.test(content))return 'user.home_city';
  if(/用户/.test(content)&&/咖啡/.test(content)&&/喜欢|偏爱|偏好|喜爱|爱喝/.test(content))return 'user.preference.coffee';
  return key?.trim()||undefined;
}
export function sameMemory(a:string,b:string):boolean{return semanticText(a)===semanticText(b);}
export function blockedMemory(m:Pick<MemoryNode,'content'|'factKey'>,blocked:Array<{content:string;factKey?:string;reason?:string}>):boolean {
  const key=factIdentity(m.factKey,m.content);
  return blocked.some(b=>sameMemory(b.content,m.content)||b.reason!=='edit'&&!!key&&key===factIdentity(b.factKey,b.content));
}
