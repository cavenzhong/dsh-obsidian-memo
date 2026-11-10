# 已知问题与暂缓项（0.15.0 之后）

> 用途：记录 0.14 审查中确认但**本轮未修**的问题，方便之后快速查阅、按文件定位并批量修复。
> 状态基准：`v0.15.0`。行号会随代码改动漂移，检索时优先搜符号名/关键词。
> 原则：每条包含「位置 / 现象与影响 / 建议修法 / 优先级 / 触发条件」，优先级 P1 > P2 > P3。

## 已明确暂缓（产品/环境决定，不是遗漏）

### KI-01 overlay 抽屉遮挡浮岛（0.15.0 已修复）

输入岛与拖拽操作栏根据阅读面板的实际宽度调整右侧留白，兼容进场动画、浮动/钉住与宽度拖拽。

### KI-02 触摸/无 hover 设备无法打开日期范围菜单
- 位置：`lib/client.js` 日期控件 `onMouseEnter: openDateMenu`、`toggleDateEnabled` 里 `setDateMenu(false)`。
- 现象：tap 会先合成 mouseenter 打开菜单，随后 click 切换筛选又把菜单关掉；iOS/Android 长按 contextmenu 对 button 不可靠，软键盘没有 ↓。档位只能停留在持久值/默认 today。
- 建议：`(hover: none)`/pointerType 分流：无 hover 时点击打开菜单，把筛选开关做成菜单内 menuitemcheckbox；并去掉 `toggleDateEnabled` 的无条件关闭。
- 优先级：P2（用户已决定「移动端之后再考虑」）。
- 触发：触摸设备或没有 hover 的输入方式。

### KI-03 日期菜单 hover 桥接区不足
- 位置：`lib/client.js` `.SN_dateGroup::after` 只覆盖按钮下方 30px × 8px；菜单宽 214px 右对齐。
- 现象：从按钮斜向左下移向菜单左半区时，会经过 group 外、菜单上方的 6px 缝隙触发 mouseleave 关闭；CONTRACT 里「菜单与按钮之间有可移入区域」并不完全成立。
- 建议：把桥挂到菜单上（`.SN_sortMenu::before{top:-8px;left:0;right:0;height:8px}`），或 mouseleave 延迟 120ms 关闭。
- 优先级：P3（用户已决定「先不改」）。

### KI-04 拖放落在胶囊外可能触发浏览器默认导航
- 位置：`lib/client.js` 仅 `<form class="SN_capture">` 上处理 dragenter/dragover/drop；dock 的 22px 内边距区与墙面没有兜底。
- 现象：Web GUI 在浏览器里把图片丢到胶囊外，可能按浏览器默认行为打开文件、丢失 SPA 状态（Electron 外壳实测「似乎没事」）。
- 建议：在 `.SN_wallWrap` 或 document 上对 `dataTransfer.types` 含 `Files` 的 dragover/drop 做 preventDefault。
- 优先级：P3（用户已实测，暂不改）。

## 待处理

### KI-05 Default Template 正文语义仍与 Obsidian 不完全一致
- 位置：`lib/capture.js` `captureFrontmatter`/`createCapturedNote`；CONTRACT §11.1。
- 现状：模板有 frontmatter → 新建只写 meta；模板无 frontmatter + 空正文 → 可能写 0 字节文件，Obsidian 开着才会补整份模板（依赖 Obsidian 是否运行）。
- 建议（方案 A）：空正文且无图时 Host 渲染整份模板（frontmatter + body + 变量）；有正文/图片时只写 meta。需要改 CONTRACT 的「不插入模板占位正文」表述并补三种场景测试。
- 优先级：P1（取决于是否使用带正文的 Default Template）。
- 触发：使用带正文/占位内容的 Default Template，尤其模板没有 frontmatter 时。

### KI-06 请求体上限与 URL 解析不一致
- 位置：`lib/index.js` 路由 `req.url?.split('?')[0] === .../createNote` 选 limit；后面又用 `new URL().pathname` 算 pathEndpoint。
- 现象：`/sticky-notes/x/../createNote` 会按 2MB 判；method/path 不匹配时会先缓冲最多 25MB 再拒；默认 2MB 未给 JSON 转义留余量，极端正文可能接近上限时被 400（裸 `unreadable body`，客户端变 transport 错误）。
- 建议：读 body 前统一算一次 `pathname` 并据它选 limit；默认 limit 改为 `maxFileBytes * 2`；createNote 用 `ceil(captureTotalBytes*4/3) + maxFileBytes*2 + 1MB` 推导；Client 提交前先估算大小给本地化提示；补路径形态/边界测试。
- 优先级：P2。

### KI-07 硬链接发布的环境兼容、孤儿附件与改名覆盖窗口
- 位置：`lib/capture.js` `await link(temp, target)`；`lib/index.js` `endpointSaveNote` 的 `rename(filePath, target)`。
- 现象：
  1. `link()` 在 exFAT/SMB/NAS/部分虚拟 FS 可能返回 EPERM/ENOTSUP，新建整条失败；
  2. 附件先落盘、崩溃/SIGKILL 会留无引用孤儿图片；
  3. `saveNote` 改名用 `rename` 会静默覆盖同名目标（TOCTOU），与 createNote「绝不覆盖」语义不一致。
- 建议：`link` 捕获 EPERM/ENOTSUP/EACCES/EXDEV 后回退 `open(target,'wx')` + 写入；附件用插件数据目录 journal（发布前记录、成功后移除、启动时清理未发布项）；改名统一改成 `link`+unlink 的 no-overwrite 发布（大小写不敏感同文件特殊处理）。
- 优先级：P2（仅当 vault 可能放网络盘/移动盘时提前）。

### KI-08 Obsidian 自定义配置目录未支持
- 位置：`lib/capture.js` 硬编码 `.obsidian`；`community-plugins.json` 的启用判断已在本轮改为保守（缺失/损坏/非数组 = 未启用）。
- 现象：使用 Obsidian「Override config folder」时读不到模板配置，静默不套模板。
- 建议：优先读 Obsidian 全局配置里的 vault `configDir`，取不到回退 `.obsidian`；或加一个「Obsidian 配置目录」设置项（默认 `.obsidian`，必须在仓库内）。
- 优先级：P3。

### KI-09 卡片缩略图 1.5MB 上限 vs 保存上限 8MB
- 位置：`lib/shared.js` `LIMITS.cardImageMaxBytes`；`lib/client.js` 卡片图片 `maxBytes: CARD_IMAGE_MAX_BYTES`。
- 现象：关闭压缩或高质量/大边长保存的图片可能超过 1.5MB，卡片会静默不显示缩略图（阅读抽屉仍可看原图）。
- 建议：提高 `cardImageMaxBytes`（注意 LRU 字节预算），或客户端上传前生成缩略图（需要新字段/端点）；短期至少在设置提示里说明。
- 优先级：P2（仅常用「关闭压缩」时明显）。

### KI-10 可访问性细节
- 位置：`lib/client.js` 浮岛标题/正文无字段级 `:focus-visible`；缩略图 `div tabIndex=0` 无 `role`/名称；预览 `role="tooltip"` 未 `aria-describedby` 关联；日期按钮 `aria-haspopup="menu"` 但点击只切换筛选；`capture.submitHint` 在 Windows/Linux 也显示 ⌘。
- 建议：字段级 focus 样式；缩略图加 `role="group"`/`aria-label`；tooltip 关联；日期按钮语义二选一（点击打开菜单或去掉 haspopup）；按平台显示 Ctrl/⌘。
- 优先级：P2（与后续交互修改一起做）。

### KI-11 `normalizeImageCompression` 类型强制
- 位置：`lib/shared.js` `normalizeImageCompression`；`lib/client.js` 的同名副本。
- 现象：`'  '`、`true`、`[]` 会被转成 quality=1；`'false'` 字符串会让 enabled=true；手改 settings.json 可得到奇怪值。
- 建议：数值只接受 `typeof value === 'number' && Number.isFinite(value)`；`enabled` 只接受严格 boolean；Host/Client 两份同步，补边界测试。
- 优先级：P3。

### KI-12 正文总大小的 off-by-one
- 位置：`lib/capture.js`（`text = content + "\n"` 后与 `LIMITS.maxFileBytes` 比较）。
- 现象：正文恰好 2MiB 时因多一个换行被判「正文过大」，差 1 字节。
- 建议：先比较 `content` 的字节数，再决定补换行；或明确 `maxFileBytes` 含尾换行并补 exact-2MiB 测试。
- 优先级：P3。

### KI-13 附件目录创建的副作用与清理错误
- 位置：`lib/capture.js` 创建附件目录在模板读取/正文校验之前；清理用 `Promise.all(unlink)` 与 `unlink(temp).catch(()=>{})`。
- 现象：模板或正文校验失败会留下空附件目录；unlink 失败会覆盖原始错误或静默残留隐藏 `.tmp`。
- 建议：先完成模板读取与正文大小校验再 mkdir；记录本次创建的目录，失败时尝试删空目录；清理失败 catch + debugLog。
- 优先级：P3。

### KI-14 `pickDirectory` 的 `initial` 参数是死参数
- 位置：`lib/client.js` `systemPick` 发 `{ initial }`；`lib/index.js` `endpointPickDirectory` 未使用 payload.initial。
- 现象：选择器不会定位到当前目录。
- 建议：确认 DSH 选择器 API 是否支持初始目录；支持则透传，不支持则删掉 client 侧未使用的 payload，避免假参数。
- 优先级：P3。

### KI-15 配置清空时已附加图片的 objectURL 未释放
- 位置：`lib/client.js` `CaptureComposer` 在 `enabled=false` 时 `return null` 但仍挂载，图片 URL 只在卸载时 revoke。
- 建议：`enabled` 变 false 时清空图片并 revoke URL；或把对象 URL 生命周期抽成 effect 统一管理。
- 优先级：P3。

### KI-16 浮岛视觉小问题
- 位置：`lib/client.js` `.SN_captureDock::before` 浅色渐变写死 `#fff`，覆盖墙底滚动条一段；展开正文改变 wall `padding-bottom` 时滚到底的内容会跳动。
- 建议：渐变改用 `var(--dsw-alias-bg-base)`；高度变化前后保持 scrollTop 锚点（或对小屏降低过渡）。
- 优先级：P3。

### KI-17 EXIF 旋转照片的压缩方向
- 位置：`lib/client.js` `compressCaptureImage`（Image → canvas → WebP）。
- 现象：未验证 canvas 在 Chromium 中是否按 EXIF orientation 绘制；若方向/比例不对，手机竖拍照片会旋转/变形。
- 建议：先用 iPhone 竖拍照片实测；若异常改用 `createImageBitmap(file, { imageOrientation: 'from-image' })` 后按 bitmap 尺寸绘制。
- 优先级：P2（仅照片场景，先测再定）。

## 建议的后续修复顺序

1. KI-05（模板正文方案，先定产品规则）或 KI-06（请求上限）——按实际使用场景二选一先做。
2. KI-09 / KI-10（压缩关闭时卡片缩略图、与 Tab 同批的 a11y）。
3. KI-07（网络盘环境才提前；journal 可拆开做）。
4. KI-11 ~ KI-16 作为同一批“清理批”处理，避免反复改同一片文件。
5. KI-17 先实测，确认后再修。

## 已修记录（避免重复排查）

- 0.14.1：RPC 失败信封 `details`、Tab 焦点范围、模板变量替换与容错、图片文件夹隐藏目录、限额单源化、正文删空自动收起、文档同步。
- 0.14.2：文件名规范化统一（`lib/filename.js`）、提交失败焦点恢复、标题 Enter/Tab 阻止冒泡、模板插件启用判断保守化、有序任务显示编号。
