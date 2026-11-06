import React, { useEffect, useState } from 'react';
import GlassModal from './GlassModal';
import { createDialogHostId, dismissDialog, pressDialog, readDialog, registerDialogHost, subscribeDialogs } from '../services/appDialog';
import type { DialogRequest } from '../services/appDialog';

export default function AppDialogHost() {
  const [id] = useState(createDialogHostId);
  const [request, setRequest] = useState<DialogRequest | null>(null);
  useEffect(() => {
    const unsubscribe = subscribeDialogs(() => setRequest(readDialog(id)));
    const unregister = registerDialogHost(id);
    return () => { unsubscribe(); unregister(); };
  }, [id]);
  if (!request) return null;
  return <GlassModal visible title={request.title} message={request.message}
    icon={request.buttons.some(button => button.style === 'destructive') ? '⚠️' : '💭'}
    busy={request.running}
    actions={request.buttons.map((button, index) => ({
      text: button.text || '确定', style: button.style,
      onPress: () => { void pressDialog(request.id, index); },
    }))}
    onConfirm={() => { void pressDialog(request.id, request.buttons.length - 1); }}
    onCancel={() => dismissDialog(request.id)} />;
}
