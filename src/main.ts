import { Plugin } from 'obsidian';
import { AIPluginSettings, DEFAULT_SETTINGS } from './types';
import { AISettingTab } from './settings';
import { AIChatView, CHAT_VIEW_TYPE } from './chat-view';
import { AIClient } from './ai-client';
import { SessionManager } from './session-manager';
import { Logger } from './logger';
import { ImageHandler } from './image-handler';

export default class AIHelperPlugin extends Plugin {
    settings: AIPluginSettings;
    aiClient: AIClient;
    sessionManager: SessionManager;
    logger: Logger;
    imageHandler: ImageHandler;

    // Папка плагина внутри vault
    private get pluginDir(): string {
        return `.obsidian/plugins/${this.manifest.id}`;
    }

    // Папка для хранения изображений внутри vault
    private get imagesDir(): string {
        return `${this.pluginDir}/images`;
    }

    async onload() {
        await this.loadSettings();

        this.logger = new Logger(
            this.app.vault,
            this.pluginDir,
            this.settings.loggingEnabled
        );

        this.sessionManager = new SessionManager(
            this.app.vault,
            this.pluginDir,
            this.imagesDir
        );

        this.imageHandler = new ImageHandler(
            this.app.vault,
            this.pluginDir,
            this.logger
        );

        // Чистим старые сессии при старте
        await this.sessionManager.cleanOldSessions(this.settings.sessionsRetentionDays);
        // Чистим старые логи при старте
        await this.logger.cleanOldLogs(this.settings.logsRetentionDays);

        // Инициализируем AI клиент
        this.aiClient = new AIClient(
            this.settings,
            this.logger,
            this.app.vault,
            this.imagesDir
        );

        // Регистрируем боковую панель справа
        this.registerView(
            CHAT_VIEW_TYPE,
            (leaf) => new AIChatView(leaf, this)
        );

        // Иконка в боковой панели слева
        this.addRibbonIcon('message-square', 'AI Helper', () => {
            this.activateView();
        });

        // Открытие чата через Command Palette
        this.addCommand({
            id: 'open-ai-chat',
            name: 'Открыть чат с AI',
            callback: () => this.activateView()
        });

        // Страница настроек плагина
        this.addSettingTab(new AISettingTab(this.app, this));

        // Размер шрифта боковой панели
        this.applyFontSize();

        await this.logger.info('Плагин загружен', { version: this.manifest.version });
    }

    async onunload() {
        this.app.workspace.detachLeavesOfType(CHAT_VIEW_TYPE);
        await this.logger.info('Плагин выгружен');
    }

    async activateView(): Promise<void> {
        const { workspace } = this.app;

        // Если панель уже открыта — фокусируемся на ней
        const existing = workspace.getLeavesOfType(CHAT_VIEW_TYPE);
        if (existing.length > 0) {
            workspace.revealLeaf(existing[0]!);
            return;
        }

        // Иначе — открываем чат в правой боковой панели
        const leaf = workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
            workspace.revealLeaf(leaf);
        }
    }

    applyFontSize(): void {
        const leaves = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE);
        if (leaves.length > 0) {
            const view = leaves[0]!.view as AIChatView;
            const container = view.containerEl.children[1] as HTMLElement;
            container.style.fontSize = `${this.settings.fontSize}px`;
        }
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
        if (this.aiClient) {
            this.aiClient.updateSettings(this.settings);
        }
        if (this.logger) {
            this.logger.setEnabled(this.settings.loggingEnabled);
        }
        // Обновляем название модели в шапке чата
        const chatView = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0]
            ?.view as AIChatView;
        if (chatView) {
            chatView.updateModelLabel(this.settings.model);
        }
    }
}
