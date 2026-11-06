/** Finish cancellation even when a native fetch/body reader ignores AbortSignal. */
export function abortError(): Error { const error = new Error('请求已取消或超时'); error.name = 'AbortError'; return error; }
export function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if(signal.aborted){void operation.catch(()=>{});return Promise.reject(abortError());}
  return new Promise<T>((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener('abort',abort);reject(abortError());};
    signal.addEventListener('abort',abort,{once:true});
    operation.then(value=>{signal.removeEventListener('abort',abort);if(signal.aborted)reject(abortError());else resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
  });
}
/** Native stream cleanup must never hold a chat/scene request lock indefinitely. */
export function cancelReader(reader?: ReadableStreamDefaultReader<Uint8Array>) {
  if(!reader)return;
  try{void reader.cancel().catch(()=>{});}catch{/* Already closed native reader. */}
  try{reader.releaseLock();}catch{/* A native read is still unwinding after abort. */}
}
