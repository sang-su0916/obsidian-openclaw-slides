import {
  App,
  Plugin,
  PluginSettingTab,
  Setting,
  Modal,
  Notice,
  MarkdownView,
  requestUrl,
  SuggestModal,
} from "obsidian";

/* ------------------------------------------------------------------ */
/*  Types & Constants                                                  */
/* ------------------------------------------------------------------ */

interface OpenClawSlidesSettings {
  gatewayUrl: string;
  gatewayToken: string;
  defaultTheme: string;
  workspacePath: string;
  autoOpen: boolean;
}

const DEFAULT_SETTINGS: OpenClawSlidesSettings = {
  gatewayUrl: "http://127.0.0.1:18789",
  gatewayToken: "",
  defaultTheme: "brutal",
  workspacePath: "",
  autoOpen: true,
};

interface ThemeOption {
  id: string;
  name: string;
  emoji: string;
  desc: string;
}

const THEMES: ThemeOption[] = [
  { id: "brutal",   name: "Neo Brutalism",     emoji: "🎨", desc: "굵은 테두리 · 비비드 컬러 · 오프셋 그림자" },
  { id: "clay",     name: "Clay 3D",           emoji: "🧸", desc: "파스텔 라벤더 · 글래스모피즘 · 클레이" },
  { id: "ghibli",   name: "Ghibli Pastel",     emoji: "🌿", desc: "수채화 텍스처 · 나눔명조 · 세피아" },
  { id: "luxury",   name: "Corporate Luxury",  emoji: "👑", desc: "블랙+골드 · Playfair 세리프 · VIP" },
  { id: "doraemon", name: "Doraemon",          emoji: "🔔", desc: "블루+화이트 · Jua 폰트 · 재미있는 강의" },
  { id: "totoro",   name: "Totoro",            emoji: "🌳", desc: "포레스트 그린 · Gamja Flower · 자연 힐링" },
];

/* ------------------------------------------------------------------ */
/*  Theme Selector (Suggest Modal)                                     */
/* ------------------------------------------------------------------ */

class ThemeSuggestModal extends SuggestModal<ThemeOption> {
  onChoose: (theme: ThemeOption) => void;

  constructor(app: App, onChoose: (t: ThemeOption) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("테마를 선택하세요…");
  }

  getSuggestions(query: string): ThemeOption[] {
    const q = query.toLowerCase();
    return THEMES.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.id.includes(q) ||
        t.desc.includes(q)
    );
  }

  renderSuggestion(theme: ThemeOption, el: HTMLElement) {
    el.createEl("div", { text: `${theme.emoji} ${theme.name}`, cls: "ocs-theme-title" });
    el.createEl("small", { text: theme.desc, cls: "ocs-theme-desc" });
  }

  onChooseSuggestion(theme: ThemeOption) {
    this.onChoose(theme);
  }
}

/* ------------------------------------------------------------------ */
/*  Progress Modal                                                     */
/* ------------------------------------------------------------------ */

class ProgressModal extends Modal {
  msgEl: HTMLElement;
  dotInterval: number | null = null;

  constructor(app: App, themeName: string) {
    super(app);
    this.modalEl.addClass("ocs-progress-modal");
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "🐾 OpenClaw Slides" });
    this.msgEl = contentEl.createEl("p", {
      text: `${themeName} 테마로 강의안 생성 중`,
      cls: "ocs-progress-msg",
    });

    let dots = 0;
    this.dotInterval = window.setInterval(() => {
      dots = (dots + 1) % 4;
      this.msgEl.setText(
        `${themeName} 테마로 강의안 생성 중${".".repeat(dots)}`
      );
    }, 500);
  }

  setResult(success: boolean, msg: string) {
    if (this.dotInterval) clearInterval(this.dotInterval);
    this.msgEl.setText(msg);
    this.msgEl.toggleClass("ocs-success", success);
    this.msgEl.toggleClass("ocs-error", !success);
  }

  onClose() {
    if (this.dotInterval) clearInterval(this.dotInterval);
    this.contentEl.empty();
  }
}

/* ------------------------------------------------------------------ */
/*  Main Plugin                                                        */
/* ------------------------------------------------------------------ */

export default class OpenClawSlidesPlugin extends Plugin {
  settings: OpenClawSlidesSettings = DEFAULT_SETTINGS;

  async onload() {
    await this.loadSettings();

    // Command: pick theme then generate
    this.addCommand({
      id: "generate-slides",
      name: "강의안 생성 (테마 선택)",
      icon: "presentation",
      callback: () => this.promptAndGenerate(),
    });

    // Command: generate with default theme
    this.addCommand({
      id: "generate-slides-default",
      name: "강의안 생성 (기본 테마)",
      icon: "presentation",
      callback: () => {
        const theme = THEMES.find((t) => t.id === this.settings.defaultTheme) || THEMES[0];
        this.generate(theme);
      },
    });

    // Ribbon icon
    this.addRibbonIcon("presentation", "OpenClaw Slides", () =>
      this.promptAndGenerate()
    );

    this.addSettingTab(new SettingsTab(this.app, this));
  }

  /* ---------- generation flow ---------- */

  private promptAndGenerate() {
    new ThemeSuggestModal(this.app, (theme) => this.generate(theme)).open();
  }

  private async generate(theme: ThemeOption) {
    // 1) validate
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("❌ 마크다운 노트를 열어주세요");
      return;
    }
    const content = view.editor.getValue().trim();
    if (!content) {
      new Notice("❌ 노트 내용이 비어있습니다");
      return;
    }
    if (!this.settings.gatewayToken) {
      new Notice("❌ Settings → OpenClaw Slides → Gateway Token을 설정해주세요");
      return;
    }

    const title = view.file?.basename || "강의안";

    // 2) build prompt
    const themeCmd: Record<string, string> = {
      brutal: "/slide_brutal",
      clay: "/slide_clay",
      ghibli: "/slide_ghibli",
      luxury: "/slide_luxury",
      doraemon: "/slide_doraemon",
      totoro: "/slide_totoro",
    };
    const cmd = themeCmd[theme.id] || "/slide";

    const prompt = [
      `${cmd} 다음 노트 내용을 기반으로 강의안을 만들어줘.`,
      `제목: "${title}"`,
      ``,
      `생성 완료 후 반드시 파일 경로를 [SLIDE_PATH: 경로] 형식으로 알려줘.`,
      ``,
      `---`,
      ``,
      content,
    ].join("\n");

    // 3) show progress
    const progress = new ProgressModal(this.app, theme.name);
    progress.open();

    try {
      const resp = await requestUrl({
        url: `${this.settings.gatewayUrl}/v1/chat/completions`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.settings.gatewayToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "openclaw:main",
          messages: [{ role: "user", content: prompt }],
          stream: false,
        }),
        throw: false,
      });

      if (resp.status !== 200) {
        const errBody = typeof resp.json === "object" ? JSON.stringify(resp.json) : resp.text;
        progress.setResult(false, `❌ Gateway 오류 (${resp.status}): ${errBody}`);
        return;
      }

      const data = resp.json;
      const reply: string = data?.choices?.[0]?.message?.content || "";

      // Try to find output path
      const pathPatterns = [
        /\[SLIDE_PATH:\s*(.+?)\]/,
        /artifacts\/[^\s\]`"')]+\.html/,
        /workspace\/artifacts\/[^\s\]`"')]+/,
      ];

      let slidePath = "";
      for (const pat of pathPatterns) {
        const m = reply.match(pat);
        if (m) {
          slidePath = m[1] || m[0];
          break;
        }
      }

      if (slidePath) {
        // Ensure absolute path
        if (!slidePath.startsWith("/")) {
          const ws = this.settings.workspacePath || "/Users/isangsu/.openclaw/workspace";
          slidePath = `${ws}/${slidePath}`;
        }
        progress.setResult(true, `✅ 생성 완료!\n📁 ${slidePath}`);

        if (this.settings.autoOpen) {
          window.open(`file://${slidePath}`);
        }
      } else {
        progress.setResult(true, "✅ 생성 완료! (경로를 자동 감지하지 못했습니다. 텔레그램에서 확인해주세요.)");
      }

      // Also show as notice
      new Notice("🐾 강의안 생성 완료!");

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      progress.setResult(false, `❌ 연결 실패: ${msg}`);
    }
  }

  /* ---------- settings ---------- */

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

/* ------------------------------------------------------------------ */
/*  Settings Tab                                                       */
/* ------------------------------------------------------------------ */

class SettingsTab extends PluginSettingTab {
  plugin: OpenClawSlidesPlugin;

  constructor(app: App, plugin: OpenClawSlidesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "🐾 OpenClaw Slides" });
    containerEl.createEl("p", {
      text: "OpenClaw AI가 옵시디언 노트를 강의 슬라이드(HTML)로 변환합니다.",
      cls: "setting-item-description",
    });

    // -- Gateway connection --
    containerEl.createEl("h3", { text: "🔗 Gateway 연결" });

    new Setting(containerEl)
      .setName("Gateway URL")
      .setDesc("OpenClaw Gateway HTTP 주소 (기본: http://127.0.0.1:18789)")
      .addText((text) =>
        text
          .setPlaceholder("http://127.0.0.1:18789")
          .setValue(this.plugin.settings.gatewayUrl)
          .onChange(async (v) => {
            this.plugin.settings.gatewayUrl = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Gateway Token")
      .setDesc("인증 토큰 (openclaw.json → gateway.auth.token)")
      .addText((text) => {
        text.inputEl.type = "password";
        text.inputEl.style.width = "300px";
        text
          .setPlaceholder("your-gateway-token")
          .setValue(this.plugin.settings.gatewayToken)
          .onChange(async (v) => {
            this.plugin.settings.gatewayToken = v;
            await this.plugin.saveSettings();
          });
      });

    // -- Preferences --
    containerEl.createEl("h3", { text: "⚙️ 설정" });

    new Setting(containerEl)
      .setName("기본 테마")
      .setDesc('"기본 테마로 생성" 명령에서 사용할 테마')
      .addDropdown((dd) =>
        dd
          .addOptions(
            Object.fromEntries(THEMES.map((t) => [t.id, `${t.emoji} ${t.name}`]))
          )
          .setValue(this.plugin.settings.defaultTheme)
          .onChange(async (v) => {
            this.plugin.settings.defaultTheme = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Workspace 경로")
      .setDesc("OpenClaw workspace 폴더 (비워두면 기본값 사용)")
      .addText((text) =>
        text
          .setPlaceholder("/Users/isangsu/.openclaw/workspace")
          .setValue(this.plugin.settings.workspacePath)
          .onChange(async (v) => {
            this.plugin.settings.workspacePath = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("자동 열기")
      .setDesc("생성 완료 후 브라우저에서 자동으로 열기")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoOpen).onChange(async (v) => {
          this.plugin.settings.autoOpen = v;
          await this.plugin.saveSettings();
        })
      );

    // -- Help --
    containerEl.createEl("h3", { text: "💡 사용법" });
    const helpDiv = containerEl.createDiv({ cls: "ocs-help" });
    helpDiv.innerHTML = `
      <ol>
        <li>강의 내용을 마크다운 노트에 작성</li>
        <li><kbd>Ctrl/Cmd + P</kbd> → <strong>"강의안 생성"</strong> 검색</li>
        <li>테마 선택 → AI가 슬라이드 생성</li>
        <li>브라우저에서 결과 확인 → <kbd>Ctrl + P</kbd>로 PDF 인쇄</li>
      </ol>
      <p><strong>팁:</strong> 사이드바의 🎬 아이콘을 클릭해도 됩니다.</p>
    `;
  }
}
