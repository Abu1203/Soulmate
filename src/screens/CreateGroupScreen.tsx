// ============================================================
// Soulmate — 创建群聊页面（修复版：并发安全 + 成员类型约束）
// ============================================================
import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, TextInput, FlatList, StyleSheet } from 'react-native';
import { AppAlert } from '../services/appDialog';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { useAgentSoul } from '../contexts/AgentSoulContext';
import { createConversation } from '../services/agentsoulStorage';

export default function CreateGroupScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { conversations, addConversation } = useAgentSoul();
  const [name, setName] = useState('');
  const creatingRef = useRef(false);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const handleCreate = async () => {
    const n = name.trim() || `群聊 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    if (selected.length < 2 || creatingRef.current) return;
    creatingRef.current = true; setCreating(true);

    // 创建群聊 conversation
    const conv = createConversation();
    conv.name = n;
    conv.type = 'group';
    conv.memberIds = selected;
    conv.settings = {
      systemPrompt: n,
      background: '',
      temperature: 0.7,
      topP: 0.9,
    };

    // ✅ 通过 Context 管道写入 → 侧边栏即时可见
    try {
      await addConversation(conv);
      navigation.replace('GroupChat', { convId: conv.id });
    } catch (e) { AppAlert.alert('群聊未创建', e instanceof Error ? e.message : '保存失败，请重试'); }
    finally { creatingRef.current = false; setCreating(false); }
  };

  // 可选的成员：排除已有 type 标记的非私聊对话（避免把群聊加入群聊）
  const candidateMembers = conversations.filter(c => !c.type || c.type === 'private');

  return (
    <View style={[styles.ct, { backgroundColor: colors.background }]}>
      {/* 导航栏 */}
      <View style={[styles.nav, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ color: isDark ? '#FFF' : '#1A1A1A', fontSize: 14 }}>取消</Text>
        </TouchableOpacity>
        <Text style={{ color: isDark ? '#FFF' : '#1A1A1A', fontSize: 18, fontWeight: '600' }}>
          创建群聊
        </Text>
        <TouchableOpacity onPress={handleCreate} disabled={selected.length < 2 || creating}>
          <Text style={{
            color: selected.length >= 2 ? colors.primary : '#999',
            fontSize: 14, fontWeight: '600',
          }}>
            {creating ? '保存中…' : '创建'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 群名称输入 */}
      <TextInput
        style={[styles.inp, {
          color: isDark ? '#FFF' : '#1A1A1A',
          backgroundColor: isDark ? '#222' : '#F5F5F5',
        }]}
        value={name}
        onChangeText={setName}
        placeholder="输入群聊名称"
        placeholderTextColor="#999"
        maxLength={20}
      />

      {/* 成员选择提示 */}
      <Text style={{
        color: colors.textSecondary, fontSize: 13,
        paddingHorizontal: 16, marginBottom: 8,
      }}>
        已选 {selected.length} 个成员（至少 2 个）
      </Text>

      {/* 成员列表 */}
      <FlatList
        data={candidateMembers}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => toggle(item.id)}
            style={[styles.row, { borderBottomColor: colors.separator }]}
          >
            <Text style={{ fontSize: 18 }}>
              {selected.includes(item.id) ? '✅' : '○'}
            </Text>
            <Text style={{ color: colors.text, fontSize: 16, marginLeft: 12 }}>
              {item.name}
            </Text>
          </TouchableOpacity>
        )}
        keyExtractor={i => i.id}
        contentContainerStyle={{ paddingHorizontal: 16 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  ct: { flex: 1 },
  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  inp: {
    margin: 16, padding: 12, borderRadius: 10, fontSize: 16,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 0.5,
  },
});
