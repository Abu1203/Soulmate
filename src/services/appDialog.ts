export interface DialogButton {
  text?: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void | Promise<void>;
}
interface DialogOptions { cancelable?: boolean; onDismiss?: () => void }
export interface DialogRequest {
  id: number;
  title: string;
  message: string;
  buttons: DialogButton[];
  options?: DialogOptions;
  running: boolean;
}

// Keep background-task feedback alive after its originating screen has closed.
let sequence = 0;
const requests: DialogRequest[] = [];
const hosts: string[] = [];
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

export const AppAlert = {
  alert(title: string, message = '', buttons?: DialogButton[], options?: DialogOptions): void {
    const choices: DialogButton[] = (buttons?.length ? buttons : [{ text: '知道了' }]).map(button => ({ ...button, style: button.style || (button.text === '取消' ? 'cancel' : 'default') }));
    // Repeated background save failures are one notification, not an unbounded
    // stack of identical native modals. Never coalesce actionable confirmations.
    if(!options?.onDismiss&&!choices.some(b=>b.onPress)&&requests.some(r=>!r.options?.onDismiss&&r.options?.cancelable===options?.cancelable&&r.title===title&&r.message===message&&!r.buttons.some(b=>b.onPress)&&r.buttons.length===choices.length&&r.buttons.every((b,i)=>b.text===choices[i].text&&b.style===choices[i].style)))return;
    requests.push({ id: ++sequence, title, message, buttons: choices, options, running: false });
    notify();
  },
};

export function subscribeDialogs(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function createDialogHostId(): string { return 'dialog-host-' + (++sequence); }
export function registerDialogHost(id: string): () => void {
  hosts.push(id); notify();
  return () => { const index = hosts.lastIndexOf(id); if (index >= 0) hosts.splice(index, 1); notify(); };
}
export function readDialog(id: string): DialogRequest | null {
  return hosts[hosts.length - 1] === id ? requests[0] || null : null;
}
export async function pressDialog(id: number, buttonIndex: number): Promise<void> {
  const current = requests[0], button = current?.buttons[buttonIndex];
  if (!current || current.id !== id || current.running || !button) return;
  requests[0] = { ...current, running: true }; notify();
  try { await button.onPress?.(); }
  catch (error) { AppAlert.alert('操作未完成', error instanceof Error ? error.message : '请稍后重试'); }
  finally { if (requests[0]?.id === id) requests.shift(); notify(); }
}
export function dismissDialog(id: number): void {
  const current = requests[0];
  if (!current || current.id !== id || current.running || current.options?.cancelable === false) return;
  const cancelIndex = current.buttons.findIndex(button => button.style === 'cancel');
  if (cancelIndex >= 0) { void pressDialog(id, cancelIndex); return; }
  requests.shift(); notify(); current.options?.onDismiss?.();
}
