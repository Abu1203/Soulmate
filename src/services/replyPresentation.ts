import type { AgentSoulMessage } from '../types/agentsoul';
import { selectedVersion } from './storyEngine';
import { stripBracketAnnotations } from './replyParser';

export type DisplayMessage = AgentSoulMessage & { unitId?:string; bodyText?:string; continuation?:boolean };

/** Immutable historical messages keep their row identity during streaming updates. */
export function createMessageRows() {
  const plain=new WeakMap<AgentSoulMessage,DisplayMessage[]>(),pure=new WeakMap<AgentSoulMessage,DisplayMessage[]>();
  return (messages:AgentSoulMessage[],pureTextMode=false):DisplayMessage[]=>{
    const cache=pureTextMode?pure:plain,rows:DisplayMessage[]=[];
    for(let index=messages.length-1;index>=0;index--){
      const m=messages[index];let parts=cache.get(m);
      if(!parts){
        if(m.role!=='assistant')parts=[m];
        else{
          const version=selectedVersion(m),content=pureTextMode?stripBracketAnnotations(version.content):version.content;
          const split=version.splitMessages??m.splitMessages??!!m.legacyParts?.length;
          const bodies=split?sentenceSegments(content):[content];
          parts=bodies.length>1?bodies.map((bodyText,i)=>({...m,id:i?m.id+':part:'+i:m.id,unitId:m.id,bodyText,continuation:i>0,...(i?{thinking:undefined,versions:[],replyVersions:undefined,versionIndex:1,selectedReplyVersionId:undefined}:{thinking:version.thinking})})):[{...m,bodyText:content}];
        }
        cache.set(m,parts);
      }
      for(let part=parts.length-1;part>=0;part--)rows.push(parts[part]);
    }
    return rows;
  };
}

/** Historical whole replies stay whole; only known legacy split records inherit splitting. */
export function usesSplitPresentation(message: AgentSoulMessage): boolean {
  return selectedVersion(message).splitMessages ?? message.splitMessages ?? !!message.legacyParts?.length;
}

/** Sentence breaks are display-only. Do not break bracketed stage directions or decimals. */
export function sentenceSegments(content: string): string[] {
  const pairs: Record<string,string> = { '(':')', '（':'）', '[':']', '【':'】', '〔':'〕' };
  const closers=new Set(['”','’','」','』','"']);
  const stack:string[]=[], result:string[]=[];let part='';
  for(let i=0;i<content.length;i++){
    const char=content[i];part+=char;
    if(pairs[char])stack.push(pairs[char]);
    else if(stack.at(-1)===char)stack.pop();
    const period=char==='.' && !(/\d/.test(content[i-1]||'') && /\d/.test(content[i+1]||'')) && (i===content.length-1 || /\s/.test(content[i+1]) || closers.has(content[i+1]));
    if(!stack.length && (/[。！？!?]/.test(char)||period)){
      while(i+1<content.length&&(/[。！？!?]/.test(content[i+1])||closers.has(content[i+1])))part+=content[++i];
      if(part.trim())result.push(part.trim());part='';
    }
  }
  if(part.trim())result.push(part.trim());
  return result.length?result:[''];
}
