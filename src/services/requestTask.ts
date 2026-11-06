export class RequestTasks {
  private tasks = new Map<string, AbortController>();
  begin(scope: string): AbortController {
    if (this.tasks.has(scope)) throw new Error('这段对话仍在生成中，请先停止或稍候');
    const controller = new AbortController(); this.tasks.set(scope, controller); return controller;
  }
  active(scope: string, controller: AbortController) { return this.tasks.get(scope) === controller && !controller.signal.aborted; }
  busy(scope: string) { return this.tasks.has(scope); }
  end(scope: string, controller: AbortController) { if (this.tasks.get(scope) === controller) this.tasks.delete(scope); }
  cancel(scope: string) { this.tasks.get(scope)?.abort(); }
  cancelAll() { this.tasks.forEach(c => c.abort()); }
  async waitForIdle(timeoutMs=5000){const until=Date.now()+timeoutMs;while(this.tasks.size){if(Date.now()>=until)throw Error('请求尚未停止，未开始恢复，请稍后重试');await new Promise<void>(resolve=>setTimeout(resolve,20));}}
}
// One owner per group even when navigation briefly mounts two copies of its screen.
export const groupRequestTasks = new RequestTasks();

export const momentRequestTasks = new RequestTasks();
