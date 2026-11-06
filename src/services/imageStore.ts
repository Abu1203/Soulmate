// ============================================================
// imageStore — 图片持久化工具
// 修复：头像/背景图"保存后过一会儿就没了"
// 根因：ImagePicker 返回的是临时缓存 URI（cache/ImagePicker/...），
//       系统清理缓存/重启后临时文件被删，已保存的 URI 失效 → 图片消失。
// 方案：选图后立即复制到应用持久目录（document/user-media），保存持久 URI。
// ============================================================
import { File, Directory, Paths } from 'expo-file-system';

const MEDIA_DIR_NAME = 'user-media';

/** Copy local picker images before saving their URI. Failure must reach the caller; existing media are never overwritten. */
export async function persistImageUri(uri: string, name?: string): Promise<string> {
  if (!uri) return uri;
  if (/^https?:\/\//i.test(uri)) return uri;
  if (!/^(file|content):\/\//i.test(uri)) throw new Error('此图片地址无法持久保存，请重新从相册选择');
  try {
    const dir = new Directory(Paths.document, MEDIA_DIR_NAME);
    dir.create({ intermediates: true, idempotent: true });
    // 已在持久目录 → 不需要再复制（补尾斜杠，避免误判 user-mediaXYZ/... 之类前缀）
    const base = dir.uri.endsWith('/') ? dir.uri : dir.uri + '/';
    if (uri.startsWith(base)) return uri;

    // 提取扩展名（截掉 query 部分后匹配），默认 .jpg
    const clean = uri.split('?')[0];
    const m = /\.(png|jpe?g|gif|webp|heic|bmp)$/i.exec(clean);
    const ext = m ? m[0].toLowerCase() : '.jpg';
    // New immutable file: changing an avatar cannot destroy a previously saved image if metadata persistence fails.
    const fileName = `${name ? name.replace(/[^a-zA-Z0-9_-]/g, '') + '_' : ''}${Date.now()}_${Math.random().toString(36).slice(2, 10)}${ext}`;

    const dest = new File(dir, fileName);
    const src = new File(uri);
    await src.copy(dest, { overwrite: false });
    return dest.uri;
  } catch (e) {
    throw new Error('图片未能保存到应用目录，请检查存储空间后重试');
  }
}
