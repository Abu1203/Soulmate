// ============================================================
// Soulmate — 转账页面
// ============================================================
import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { AppAlert } from '../services/appDialog';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { appendGroupMessage } from '../services/groupStorage';
import { useTheme } from '../contexts/ThemeContext';
import { useAgentSoul } from '../contexts/AgentSoulContext';

export default function TransferScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { addSystemMessageTo, sendMessage, activeConversation, conversations } = useAgentSoul();
  const roleName = route.params?.roleName || 'AI';
  const targetConvId = route.params?.convId;
  const fromGroup = route.params?.fromGroup === true;
  const groupConvId = route.params?.groupConvId;
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const submittingRef = useRef(false), completedRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const recordRef = useRef<{id: string; content: string; val: number; note: string} | null>(null);

  const formatAmount = (v: string) => {
    const clean = v.replace(/[^\d.]/g, '');
    const parts = clean.split('.');
    if (parts.length > 2) return amount;
    if (parts[0].length > 6) return amount;
    if (parts[1]?.length > 2) return amount;
    return clean;
  };

  const handleConfirm = async () => {
    if (submittingRef.current || completedRef.current) return;
    const val = parseFloat(amount);
    if (!Number.isFinite(val) || val <= 0 || val > 999999) return;
    const cid = targetConvId || activeConversation?.id;
    if (!cid || !conversations.some(c => c.id === cid && c.type !== 'group') ||
        (fromGroup && !conversations.some(c => c.id === groupConvId && c.type === 'group' && c.memberIds?.includes(cid)))) {
      AppAlert.alert('转账未提交', '目标角色或群聊已不存在，请返回后重试'); return;
    }
    submittingRef.current = true; setSubmitting(true);
    // Keep the same record through partial-write retries, including its original amount and note.
    const record = recordRef.current ||= { id: `tr_${Date.now()}_${Math.random().toString(36).slice(2)}`, val,
      content: `[TRANSFER]|${val}|${roleName.replace(/\|/g, '｜')}${note.trim() ? '|' + note.trim().replace(/\|/g, '｜') : ''}`, note: note.trim() };
    try {
      if (fromGroup) await appendGroupMessage(groupConvId, {
        id: record.id, role: 'user', meta: 'system', content: record.content, timestamp: Date.now(),
      });
      await addSystemMessageTo(cid, record.content, record.id);
      completedRef.current = true;
      if (!fromGroup && activeConversation?.id === cid) {
        // The durable transfer is complete; a failed model reply must not repeat the transfer.
        void sendMessage(`在虚构情境中给你转账 ${record.val} 元${record.note ? '，备注：' + record.note : ''}`,undefined,cid)
          .catch(e => AppAlert.alert('转账已记录，AI 回复失败', e instanceof Error ? e.message : '请返回聊天重试回复'));
      }
      navigation.goBack();
    } catch (e) {
      AppAlert.alert('转账记录未完整保存', (e instanceof Error ? e.message : '保存失败') + '。重试会补齐同一笔记录，不会重复转账。');
    } finally { submittingRef.current = false; setSubmitting(false); }
  };

  const canConfirm = !!amount && parseFloat(amount) > 0 && parseFloat(amount) <= 999999;

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#0A0A0A' : '#FFFFFF' }]}>
      <View style={[styles.nav, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={{ color: isDark ? '#FFF' : '#1A1A1A', fontSize: 14 }}>◀ 返回</Text></TouchableOpacity>
        <Text style={{ fontSize: 18, fontWeight: '600', color: isDark ? '#FFF' : '#1A1A1A' }}>虚拟转账</Text>
        <View style={{ width: 50 }} />
      </View>

      <View style={styles.body}>
        <Text style={{ color: isDark ? '#AAA' : '#888', fontSize: 14, marginBottom: 8 }}>转账给</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 32 }}>
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', marginRight: 10 }}>
            <Text style={{ color: '#FFF', fontSize: 16 }}>{roleName[0]}</Text>
          </View>
          <Text style={{ fontSize: 18, fontWeight: '600', color: isDark ? '#FFF' : '#1A1A1A' }}>{roleName}</Text>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
          <Text style={{ fontSize: 32, fontWeight: '600', color: isDark ? '#FFF' : '#1A1A1A', marginRight: 4 }}>¥</Text>
          <TextInput
            style={[styles.amountInput, { color: isDark ? '#FFF' : '#1A1A1A', borderBottomColor: isDark ? '#555' : '#DDD' }]}
            value={amount}
            onChangeText={(v) => setAmount(formatAmount(v))}
            placeholder="0.00"
            placeholderTextColor={isDark ? '#555' : '#CCC'}
            keyboardType="decimal-pad"
            maxLength={10}
            autoFocus
            editable={!submitting && !recordRef.current}
          />
          <Text style={{ fontSize: 20, color: isDark ? '#AAA' : '#888', marginLeft: 8 }}>元</Text>
        </View>

        <TextInput
          style={[styles.noteInput, { color: isDark ? '#FFF' : '#1A1A1A', backgroundColor: isDark ? '#1A1A1A' : '#F5F5F5' }]}
          value={note}
          editable={!submitting && !recordRef.current}
          onChangeText={setNote}
          placeholder="转账说明（选填）"
          placeholderTextColor={isDark ? '#666' : '#999'}
          maxLength={20}
        />

        <TouchableOpacity
          style={[styles.confirmBtn, { backgroundColor: canConfirm ? '#4A90D9' : (isDark ? '#444' : '#CCC') }]}
          onPress={handleConfirm}
          disabled={!canConfirm || submitting}
          activeOpacity={0.7}>
          <Text style={{ color: canConfirm ? '#FFF' : (isDark ? '#888' : '#999'), fontSize: 17, fontWeight: '600' }}>{submitting ? '保存中…' : '确认转账'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 20 },
  amountInput: { fontSize: 48, fontWeight: '300', textAlign: 'center', minWidth: 120, borderBottomWidth: 1, paddingVertical: 4 },
  noteInput: { borderRadius: 10, padding: 12, fontSize: 14, marginBottom: 24 },
  confirmBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
});
