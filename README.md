# Obsidian MEMO

`dsh-obsidian-memo` · DeepSeek Harness 的 Obsidian 便签墙插件

**随手记，值得继续的想法拖成项目。笔记始终是你仓库里的 Markdown。**

![DeepSeek Harness 0.2.x](https://img.shields.io/badge/DeepSeek%20Harness-0.2.x-111?style=flat-square) [![npm](https://img.shields.io/npm/v/dsh-obsidian-memo?style=flat-square&color=111)](https://www.npmjs.com/package/dsh-obsidian-memo) [![MIT](https://img.shields.io/badge/license-MIT-111?style=flat-square)](LICENSE) · [English](README.en.md)

[安装](#安装) · [把便签变成项目](#把便签变成项目) · [日常用法](#日常用法) · [常见问题](#常见问题)

![便签墙与底部快速记录栏](docs/assets/cover.png)

- **想到就记**：`Enter` 存标题，`Tab` 写正文，`⌘ / Ctrl + Enter` 提交图文；图片可粘贴或拖入，默认压缩成 WebP。
- **一边看全局，一边处理一张**：子文件夹分色、按日期筛选；点开卡片钉住右侧面板，边浏览边勾待办。
- **卡住时，让 AI 换个角度**：四种 emoji 评论复用 Harness 的默认模型，结果以 callout 写回原笔记。
- **把便签变成项目**：拖到「到项目」，AI 更新当前概况、追加进展记录；源便签不动，只多一条双链。
- **笔记仍归 Obsidian**：不导入、不迁移，只读写你选定的文件夹，frontmatter 原样保留。

> **数据边界**：除你主动触发的 AI 评论和项目更新外，插件不主动联网，也不单独保存 API Key。

它不是 Obsidian 的替代品：不做全文搜索、双链和插件生态，也还没适配移动端。

## 安装

需要 **DeepSeek Harness 0.2.2-rc.1 或更高的 0.2.x 版本**，以及 Harness 能访问的本地 Obsidian 仓库。不用在 Obsidian 里另装插件。

1. 在 Harness 的 **插件 → 添加插件** 中输入 `dsh-obsidian-memo`，安装并启用；装完在插件页确认版本为 **0.17.0** 或更高。
2. 如果 DSH 提示需要重启，重启一次；然后打开左侧栏的便签入口，点右上角 **设置 → 文件夹**，选择 **Obsidian 仓库** 和 **便签文件夹**。
3. 在底部写一句，按 `Enter` 存下第一张便签。想用项目跟踪？再选一个 **项目索引目录**。

也可以在对话里让 agent 安装：

```text
action: install_bundle
target: dsh-obsidian-memo
```

npm 上的 `dsh-sticky-notes` 是另一款 DSH 便签插件，与本项目无关。更新和卸载都在插件页完成，卸载只移除插件注册，不会删除你的笔记。

## 把便签变成项目

拖一张便签到 **「到项目」**，可以新建项目，也可以补充到已有项目。源便签留在原处，只多一条指向项目的 Obsidian 双链。

![拖动便签到「到项目」时，可选新建项目或已有的「河湾声音展」](docs/assets/project-drop.png)

*拖到「到项目」会列出新建和已有项目；补充默认等 3 秒，可取消。*

每次补充，AI 更新 **当前概况**，并在 **进展记录** 末尾追加一条。先看概况就知道现在到哪一步，想追溯再翻历史。旧记录和「我的手记」之类的独立二级章节原样保留。

![补充进展后显示「场地恢复排期，场次和开放时间待定」，可查看、确认或撤销](docs/assets/project-review.png)

*写入后先看变更摘要；不合适可以在确认前撤销，项目和源便签一起还原。重启 Harness 后不能再撤销这次更新。*

[看看项目文档示例](docs/GUIDE.md#项目文档怎么读怎么补充)。

## 日常用法

### 想到就记，直接贴图

底部输入栏里，`Enter` 存标题，`Tab` 展开正文，`⌘ / Ctrl + Enter` 提交图文。图片可以直接粘贴或拖进去，默认压缩成 WebP。

![快速记录栏：已填写标题、正文，并添加两张参考图](docs/assets/capture.png)

### 左边看全局，右边处理一张

便签墙按子文件夹分色，可按日期筛选。点开卡片、钉住右侧面板，就能一边浏览一边勾待办；双击标题或正文可编辑。卡住了？点一个 emoji，让 AI 写条评论，例如 🧭 **落地** 会给出一个可试的下一步。也可以拖去归档，或回 Obsidian 继续。

![便签墙与钉住的阅读面板并排，展示任务清单和「落地」AI 评论](docs/assets/reader.png)

## 常见问题

**看不到入口，或便签墙是空的？** 先确认插件已启用，必要时按提示重启 DSH——桌面版通常要重启一次才会出现侧栏入口。墙面为空时，检查便签文件夹里是否有 `.md` 文件，试着关掉日期筛选；如果笔记都在子文件夹里，打开子文件夹开关。

**AI 要另配 Key 吗？没生成怎么办？** 不用另配。评论用 Harness 的默认模型，项目可以在 **设置 → AI → 项目 AI** 单独选模型。没生成时，先检查模型配置，再按面板提示重试或调整预算。

**更新、卸载会动我的笔记吗？** 更新在插件页按 npm 版本进行；卸载只移除插件注册，笔记和附件留在仓库里。

**支持哪些系统？** 主要在 macOS 上开发验证；Windows / Linux 的路径与「在 Obsidian 打开」已实现但未实测，移动端没有专门适配，以桌面为主。

**笔记会上传吗？** 笔记和附件留在本地仓库。只有你主动使用 AI 评论或项目功能时，相关便签及所需的项目内容才会发给配置的模型服务。

**误删便签怎么办？** 便签移入仓库内的 `.trash`，不是直接永久删除。删除后可以在提示消失前撤回；错过了也可以从库内回收站找回。

---

[详细指南](docs/GUIDE.md) · [版本记录](docs/CHANGELOG.md) · [开发导航](docs/ARCHITECTURE.md) · [已知问题](docs/KNOWN_ISSUES.md) · [反馈问题](https://github.com/cavenzhong/dsh-obsidian-memo/issues) · [MIT 许可](LICENSE)
