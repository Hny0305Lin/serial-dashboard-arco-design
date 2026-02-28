# 转发渠道指标行：单行布局与溢出可用性报告

适用范围：监控页「转发」组件中的渠道卡片统计行（队列/成功/失败/延迟）。

## 1) 样式代码（强制单行 + 溢出处理 + 交互）

### 实际生效样式

注入位置：[MonitorCanvas.tsx](file:///c:/Users/lmj-m/OneDrive%20-%20GBCLStudio/%E6%96%87%E6%A1%A3/serialport/web/src/components/Monitor/MonitorCanvas.tsx)

```css
.forwarding-channel-metrics-row {
  margin-top: 6px;
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  max-width: 100%;
  -webkit-overflow-scrolling: touch;
}
.forwarding-channel-metrics-row > * + * {
  margin-left: 10px;
}
@supports (gap: 10px) {
  .forwarding-channel-metrics-row {
    gap: 10px;
  }
  .forwarding-channel-metrics-row > * + * {
    margin-left: 0;
  }
}
.forwarding-channel-metrics-item {
  flex: 0 0 auto;
  white-space: nowrap;
}
.forwarding-channel-metrics-row:focus-visible {
  outline: 2px solid rgba(22, 93, 255, 0.55);
  outline-offset: 2px;
  border-radius: 4px;
}
```

### 组件用法（Tooltip + 可聚焦 + aria-label）

修改位置：[ForwardingWidget.tsx](file:///c:/Users/lmj-m/OneDrive%20-%20GBCLStudio/%E6%96%87%E6%A1%A3/serialport/web/src/components/Monitor/ForwardingWidget.tsx)

- 指标容器：`className="forwarding-channel-metrics-row"`，并带 `tabIndex=0`，键盘可聚焦
- 溢出信息：Tooltip 支持 hover/focus/click，移动端可点开
- 屏幕阅读：`aria-label` 提供完整指标文本（不受视觉溢出影响）

## 2) 不同字符长度下的“可视化验证”素材

工程内已新增演示页：`/layout-singleline`
- 页面文件：[layout-singleline.astro](file:///c:/Users/lmj-m/OneDrive%20-%20GBCLStudio/%E6%96%87%E6%A1%A3/serialport/web/src/pages/layout-singleline.astro)
- 组件文件：[LayoutSingleLineDemo.tsx](file:///c:/Users/lmj-m/OneDrive%20-%20GBCLStudio/%E6%96%87%E6%A1%A3/serialport/web/src/components/LayoutSingleLineDemo.tsx)

建议截图/录屏内容（短/中/超长分别一张，或一段录屏覆盖全部）：
- 容器宽度 260px，字号 12px：短/中/超长
- 容器宽度 160px，字号 18px：短/中/超长
- 触发 Tooltip：鼠标悬停或键盘 Tab 聚焦指标行（移动端点击指标行）

## 3) 主流浏览器与移动设备兼容性测试报告

### 使用到的关键特性与兼容性结论

- `display:flex` / `flex-wrap: nowrap`：主流浏览器全支持
- `overflow-x:auto` 横向滚动：主流浏览器全支持
- `-webkit-overflow-scrolling: touch`：iOS Safari 提升滚动手感，其他浏览器忽略不影响
- `gap`（Flex 容器）：现代浏览器支持；为避免老版本不支持导致间距消失，已提供 `> * + * { margin-left: 10px }` 回退，并在支持 `gap` 时清零回退 margin
- `:focus-visible`：现代浏览器支持；不支持时仍可聚焦，只是外框样式可能不显示（不影响功能）

### 建议的实测清单（勾选项）

桌面端：
- Chrome / Edge：缩放 90%/100%/125%，确认不换行、可横向滚动、Tooltip hover/focus/click 正常
- Firefox：确认不换行、可横向滚动、Tooltip 可用；检查间距是否为 10px
- Safari（如有）：确认不换行、滚动与 Tooltip 正常

移动端：
- iOS Safari：手指横滑指标行可滚动；点击指标行可打开 Tooltip；字号放大（系统设置）不换行
- Android Chrome：同上

## 4) 可访问性评估（键盘、屏幕阅读器）

### 键盘

- 指标行可通过 Tab 聚焦（`tabIndex=0`）
- 聚焦时有可见外框（`:focus-visible`），便于定位
- Tooltip 触发包含 `focus`，键盘用户可获得完整信息

### 屏幕阅读器

- DOM 文本仍为完整指标文本（并非“把文字裁掉再替换”），屏幕阅读器可正常朗读
- 指标行额外提供 `aria-label`，保证在 Tooltip 关闭时也能读到完整的合并文本

