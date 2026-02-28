# 串口混合编码乱码：字节级分析与解析方案

本文面向“同一行/同一帧串口数据里同时夹杂可读文本 + 控制字节 + 二进制段”的场景，目标是：

- 最大化保留有效 UTF-8 文本（例如 `+SOCSQ:`、`+SOCCELL:`、中文短信等）
- 对不可解析/不可读字节提供可配置策略（替换/转义/十六进制/摘要）
- 保持结构完整：记录仍保留原始 bytes（base64），解码文本用于展示/检索/正则提取

## 1. 乱码的根因分类（你看到的“�”从哪来）

在日志里看到的 `�`（replacement char）通常不是设备“真的发了这个字符”，而是：

- 上层用 `toString('utf8')` 或 `TextDecoder('utf-8')` 解码时遇到 **非法 UTF-8 序列**
- 解码器为了“继续输出”，把非法字节替换成 `�`

此外常见“乱码/奇怪字符”的来源还有：

- `\u0000`（NUL）：常见于 C 字符串填充、定长字段、二进制结构体对齐
- `\u001b`（ESC, 0x1B）：ANSI 转义序列（彩色/光标控制），或设备/中间层注入
- `\u0004`（EOT, 0x04）：二进制协议字段、帧界定/控制字段，或线路噪声导致的偶发值
- 高位字节（0x80-0xFF）：可能是扩展 ASCII（如 Latin-1/CP1252）、也可能是二进制字段（长度/CRC/随机 payload），也可能是 **波特率/串口参数不匹配** 造成的位错误

## 2. 字节级样本分析（来自 data/records 的真实帧）

以下样本来自 `records-2026-02-28.ndjson` 中 `rawBytesBase64`（COM18），包含 `+SOCSQ:` 与中文，并夹杂控制/二进制字段。

解析器输出的分段（偏移、类型、长度、头部 hex、可读文本预览）如下：

```
inputBytes=135 asciiBytes=73 utf8Bytes=21 controlBytes=30 invalidBytes=11 binaryBytes=8
segments:
  [0-4)   ascii   "%.*s"
  [4-8)   control 00000000
  [8-9)   ascii   ">"
  [9-12)  control 000000
  [12-52) ascii   "W/user.util_notify.poll\tmobile.status\t5\t"
  [52-67) utf8    "网络已注册"
  [67-68) ascii   ","
  [68-74) utf8    "漫游"
  [74-76) control 0000
  [76-80) ascii   "~~!4"
  [80-86) control 040000000000
  [86-88) ascii   "Lj"
  [88-89) invalid D2
  [89-90) control 08
  [90-106) ascii  "+SOCSQ: %d,%d,%d"
  [106-110) control 00000000
  [110-118) binary A5FFFFFFF7FFFFFF
  [118-122) control 19000000
  [122-124) ascii  "~~"
  [124-125) invalid B5
  [125-126) ascii  "R"
  [126-132) control 040000000000
  [132-133) ascii  "L"
  [133-134) invalid EA
  [134-135) ascii  "s"
```

结论（按出现顺序）：

- 前半段是 **结构化二进制头 + ASCII 标签 + UTF-8 文本**
  - `%.*s` / `W/user...` / `+SOCSQ:` 这些都是纯 ASCII
  - `网络已注册,漫游` 是合法 UTF-8（字节序列可完整验证）
  - `\u0000` 大量出现：高度疑似定长字段/对齐填充
- `~~` 很像某个上层协议的“段落分隔/帧内 marker”
- `D2` / `B5` / `EA` 这类单字节（0x80-0xFF）在 UTF-8 里不可能单独出现，属于非法 UTF-8
- `A5 FF FF FF F7 FF FF FF` 被识别为“可能二进制段”
  - 这类字节模式更像状态位/长度/掩码/CRC，而不是文本

## 3. 编码检测算法（单行内识别混杂段落）

本项目采用“字节流扫描 + UTF-8 严格校验”的方式，不猜测复杂编码表（避免引入 iconv 等依赖），并且可稳定区分：

- **ASCII 可见字符段**：0x20-0x7E + `\t` +（可选）`\r\n`
- **控制字节段**：0x00-0x1F、0x7F（可配置保留/转义/丢弃）
- **合法 UTF-8 段**：按 UTF-8 规则识别 2/3/4 字节序列，并做最小编码/代理区间/最大码点校验
- **非法字节段**：0x80-0xFF 中无法组成合法 UTF-8 序列的字节（可配置展示策略）
- **可能二进制段**：当控制/非法字节形成连续 run 且长度达到阈值（默认 8B），或非文本占比很高时，标记为 binary

输出不仅给一个字符串，还给：

- `segments[]`：每段的 kind/start/end/bytes/text（便于做字节级诊断）
- `searchText`：仅保留 ASCII/UTF-8，用于 `startOnText`/正则提取，避免控制/二进制干扰

实现文件：`src/core/mixedEncoding.ts`

## 4. 混合编码解析策略（可配置）

### 4.1 保留有效 UTF-8

合法 UTF-8 段用一次性 `bytes.toString('utf8')` 解码，保证中文与 `+SOCSQ:` 等不被破坏。

### 4.2 无法解析字节的处理策略

通过 `decodeMixedBytes(input, options)` 配置：

- `invalidByteStrategy`
  - `escape`（默认）：输出 `\xHH`
  - `replace`：输出 `�`
  - `hex`：输出 `<HH>`
  - `latin1`：按 0x00-0xFF 直接映射到 U+0000-U+00FF（用于“扩展 ASCII”快速观察）
- `controlStrategy`
  - `escape`（默认）：输出 `\u00HH`
  - `strip`：丢弃
  - `space`：替换成空格（便于近似保持分隔）
- `binaryStrategy`
  - `summary`（默认）：输出 `<bin:{len}B:{headHex}…>`（避免日志爆炸）
  - `hex`：输出完整 HEX（谨慎使用）
  - `escape`：输出连续 `\xHH`（谨慎使用）

## 5. 如何集成到现有系统

后端已完成最小改动接入：

- `ForwardingService` 的 `startOnText` 闸门：使用 `searchText.includes(...)`，避免控制/二进制段影响匹配
- `parseFrameToRecord` 的 `text-regex` / “无正则”路径：使用混合解码结果
- `json` 模式：改为严格 UTF-8（fatal）解码，避免“看起来像 JSON 但实际混入脏字节”导致误解析

相关文件：

- `src/services/ForwardingService.ts`
- `src/services/forwarding/frame.ts`

如果你还希望前端终端显示也使用同一策略，建议做法是后端 WS 广播时同时附带解码后的 `text`/`searchText`（仍保留原始 bytes），前端只负责渲染。

## 6. 测试用例集

测试覆盖（`src/test/core/mixedEncoding.test.ts`）：

- 标准 AT 响应：`+SOCSQ:` 保持原样
- 控制字符：ESC 等按策略转义
- 高字节位：0xFF 等按策略保留/转义
- 真实样本：保留 `+SOCSQ:` 与中文，并避免 `�`
- 破损 UTF-8：不抛异常，可观察到 `\xHH`
- 大块二进制：输出被摘要化，避免日志爆炸

## 7. 性能基准（实时性证明）

在本机 Node 环境下（运行 `pnpm run perf:mixed-encoding`）：

- decodeMixedBytes(sample)：约 **17.42 MB/s**（135B 样本循环 200k 次）
- decodeMixedBytes(random1MB)：约 **4.21 MB/s**（1MB 随机数据循环 200 次）

对比常见串口吞吐：

- 115200 bps ≈ 11 KB/s
- 921600 bps ≈ 90 KB/s

即使按更重的“随机二进制”压力测试，本解析器也远高于实时串口输入速率。

