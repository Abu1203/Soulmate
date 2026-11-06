// ============================================================
// docxParser — Word (.docx) 文字提取
// 用途：人设设定页上传 Word 文档，识别文档文字填入人设输入框
// 原理：.docx 是 zip 容器，正文在 word/document.xml（OOXML），
//       段落 <w:p> 内文本节点 <w:t> 即段落文字。
// 依赖：jszip（纯 JS，无原生依赖，EAS 云端构建安全）
// ============================================================
import { File } from 'expo-file-system';
import JSZip from 'jszip';

/** 反转义 OOXML 文本实体（&lt; &gt; &quot; &apos; 先，&amp; 最后避免二次替换） */
function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * 从 .docx 文件提取纯文字（按段落换行）。
 * @param uri 本地文件 URI（file://）
 * @returns 提取的文本；段落以 \n 分隔
 * @throws 文件损坏 / 非 docx / 找不到正文时抛错
 */
export async function extractDocxText(uri: string): Promise<string> {
  const file = new File(uri);
  const buf = await file.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);

  const entry = zip.file('word/document.xml');
  if (!entry) {
    throw new Error('不是有效的 Word 文档（缺少正文）');
  }
  const xml = await entry.async('string');

  const paragraphs: string[] = [];
  // (?![^>]*\/>) 排除自闭合空段落 <w:p/>（Word 常见输出形态，避免吞并后续段落）
  const pRegex = /<w:p\b(?![^>]*\/>)[^>]*>([\s\S]*?)<\/w:p>/g;
  let m: RegExpExecArray | null;
  while ((m = pRegex.exec(xml)) !== null) {
    const inner = m[1];
    const seg = inner
      .replace(/<w:tab\b[^>]*\/>/g, '\t')
      .replace(/<w:br\b[^>]*\/>/g, '\n')
      // <w:t> 内是纯文本节点（可能带 xml:space 属性），直接取内容
      .replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, (_all, s: string) => s)
      // 清除其余所有标签（保留文本）
      .replace(/<[^>]+>/g, '');
    const text = unescapeXml(seg).replace(/[ \t]+/g, ' ').trim();
    if (text) paragraphs.push(text);
  }

  if (paragraphs.length === 0) {
    throw new Error('文档中没有识别到文字');
  }
  return paragraphs.join('\n');
}
