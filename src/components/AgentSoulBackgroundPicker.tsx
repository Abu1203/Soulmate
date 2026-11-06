// ============================================================
// AgentSoul - 背景图片选择器
// ============================================================
import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { AppAlert } from '../services/appDialog';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../contexts/ThemeContext';
import { persistImageUri } from '../services/imageStore';

interface AgentSoulBackgroundPickerProps {
  imageUri?: string;
  onImageChange: (uri: string | undefined) => void;
}

export default function AgentSoulBackgroundPicker({
  imageUri,
  onImageChange,
}: AgentSoulBackgroundPickerProps) {
  const { colors, isDark } = useTheme();
  const handlePick = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) { AppAlert.alert('需要相册权限', '请在系统设置中允许访问相册'); return; }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      // ✅ 修复(背景图丢失)：持久化到应用目录后再回调，临时缓存 URI 会被系统清理
      if (!result.canceled && result.assets?.[0]) { onImageChange(await persistImageUri(result.assets[0].uri)); }
    } catch (e) { AppAlert.alert('背景图片未加载', e instanceof Error ? e.message : '请重试'); }
  };

  const handleRemove = () => {
    onImageChange(undefined);
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: colors.text }]}>背景图片</Text>
      <View style={styles.previewRow}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.preview} />
        ) : (
          <View style={[styles.preview, styles.placeholder, { borderColor: colors.separator, backgroundColor: colors.surfaceSecondary }]}>
            <Text style={[styles.placeholderText, { color: colors.textTertiary }]}>无背景</Text>
          </View>
        )}
        <View style={styles.buttons}>
          <TouchableOpacity style={[styles.btn, { backgroundColor: colors.surfaceSecondary }]} onPress={handlePick} activeOpacity={0.6}>
            <Text style={[styles.btnText, { color: colors.primary }]}>上传图片</Text>
          </TouchableOpacity>
          {imageUri && (
            <TouchableOpacity style={[styles.btn, styles.removeBtn, { backgroundColor: colors.error + '15' }]} onPress={handleRemove} activeOpacity={0.6}>
              <Text style={[styles.btnText, styles.removeText, { color: colors.error }]}>移除</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginVertical: 10 },
  label: { fontSize: 15, fontWeight: '500', marginBottom: 8 },
  previewRow: { flexDirection: 'row', alignItems: 'center' },
  preview: { width: 80, height: 80, borderRadius: 8 },
  placeholder: { justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderStyle: 'dashed' },
  placeholderText: { fontSize: 12 },
  buttons: { marginLeft: 12, gap: 8 },
  btn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6 },
  btnText: { fontSize: 14 },
  removeBtn: {},
  removeText: {},
});
