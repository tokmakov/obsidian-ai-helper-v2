import { ItemView, WorkspaceLeaf, MarkdownRenderer, Notice, MarkdownView, Editor } from 'obsidian';
import { ChatMessage, SourceReport } from './types';
import AIHelperPlugin from './main';
import { ChatSession } from './session-manager';
import { AttachedImage } from './image-handler';

export const CHAT_VIEW_TYPE = 'ai-chat-view-v2';

export class AIChatView extends ItemView {
    plugin: AIHelperPlugin;
    messages: ChatMessage[] = [];
    private lastEditor: Editor | null = null;
    private currentSession: ChatSession | null = null;
    private sessionListEl: HTMLSelectElement | null = null;

    private messagesContainer: HTMLElement;
    private inputEl: HTMLTextAreaElement;
    private sendButton: HTMLButtonElement;
    private isLoading: boolean = false;

    private loadLinksCheckbox: HTMLInputElement;
    private searchCheckbox: HTMLInputElement;

    private attachedImages: AttachedImage[] = [];
    private imageFooterEl: HTMLElement;

    constructor(leaf: WorkspaceLeaf, plugin: AIHelperPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string { return CHAT_VIEW_TYPE; }
    getDisplayText(): string { return 'AI Helper v2'; }
    getIcon(): string { return 'message-square'; }

    async onOpen(): Promise<void> {
        this.buildUI();

        await this.loadOrCreateSession();

        this.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (view && view.editor) {
                    this.lastEditor = view.editor;
                }
            })
        );
    }

    private async loadOrCreateSession(): Promise<void> {
        const sessions = await this.plugin.sessionManager.loadAll();
        const first = sessions[0];
        if (first) {
            await this.switchToSession(first);
        } else {
            this.currentSession = await this.plugin.sessionManager.createNew();
        }
        await this.refreshSessionList();
    }

    private buildUI(): void {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass('ai-chat-container');
        container.style.fontSize = `${this.plugin.settings.fontSize}px`;

        this.buildHeader(container);

        this.messagesContainer = container.createDiv({ cls: 'ai-chat-messages' });
        this.renderWelcome();

        this.buildInputArea(container);
    }

    private buildHeader(container: HTMLElement): void {
        const header = container.createDiv({ cls: 'ai-chat-header' });
        const headerTop = header.createDiv({ cls: 'ai-chat-header-top' });

        headerTop.createEl('span', {
            text: '👽️ AI Helper v2',
            cls: 'ai-chat-title'
        });

        headerTop.createEl('span', {
            text: this.plugin.settings.model || 'модель не выбрана',
            cls: 'ai-chat-model-label'
        });

        const newBtn = headerTop.createEl('button', {
            text: '➕',
            cls: 'ai-chat-clear-btn',
            attr: { title: 'Создать новый чат' }
        });
        newBtn.addEventListener('click', () => this.startNewSession());

        const clearBtn = headerTop.createEl('button', {
            text: '🗑️',
            cls: 'ai-chat-clear-btn',
            attr: { title: 'Удалить текущий чат' }
        });
        clearBtn.addEventListener('click', () => this.deleteCurrentSession());

        const closeBtn = headerTop.createEl('button', {
            text: '✖️',
            cls: 'ai-chat-clear-btn',
            attr: { title: 'Закрыть панель чата' }
        });
        closeBtn.addEventListener('click', () => this.leaf.detach());

        this.sessionListEl = header.createEl('select', {
            cls: 'ai-chat-session-select'
        });
        this.sessionListEl.addEventListener('change', async () => {
            const selectedId = this.sessionListEl!.value;
            const sessions = await this.plugin.sessionManager.loadAll();
            const session = sessions.find(s => s.id === selectedId);
            if (session) await this.switchToSession(session);
        });
    }

    private buildInputArea(container: HTMLElement): void {
        const inputArea = container.createDiv({ cls: 'ai-chat-input-area' });

        this.inputEl = inputArea.createEl('textarea', {
            cls: 'ai-chat-input',
            attr: { placeholder: 'Задай вопрос...', rows: '3' }
        });

        this.inputEl.addEventListener('keyup', (e: KeyboardEvent) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                e.stopPropagation();
                this.handleSend();
            }
        }, true);

        this.inputEl.addEventListener('paste', async (e: ClipboardEvent) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const item of Array.from(items)) {
                if (item.type.startsWith('image/')) {
                    e.preventDefault();
                    const file = item.getAsFile();
                    if (!file) continue;
                    const image = await this.plugin.imageHandler.processClipboardImage(file);
                    if (image) {
                        this.attachedImages.push(image);
                        this.refreshImageFooter();
                    }
                    break;
                }
            }
        });

        const checkboxRow = inputArea.createDiv({ cls: 'ai-chat-checkbox-row' });

        const linksLabel = checkboxRow.createEl('label', { cls: 'ai-chat-checkbox-label' });
        this.loadLinksCheckbox = linksLabel.createEl('input', { attr: { type: 'checkbox' } });
        linksLabel.createEl('span', { text: ' 🌐 Загружать ссылки' });

        const searchLabel = checkboxRow.createEl('label', { cls: 'ai-chat-checkbox-label' });
        this.searchCheckbox = searchLabel.createEl('input', { attr: { type: 'checkbox' } });
        searchLabel.createEl('span', { text: ' 🔍 Искать в Яндекс' });

        if (!this.plugin.settings.yandexApiKey || !this.plugin.settings.yandexFolderId) {
            this.searchCheckbox.disabled = true;
            searchLabel.title = 'Настрой Яндекс API в настройках плагина';
        }

        const inputFooter = inputArea.createDiv({ cls: 'ai-chat-input-footer' });

        this.imageFooterEl = inputFooter.createDiv({ cls: 'ai-chat-attached-list' });

        this.sendButton = inputFooter.createEl('button', {
            text: 'Отправить',
            cls: 'ai-chat-send-btn'
        });
        this.sendButton.addEventListener('click', () => this.handleSend());
    }

    private refreshImageFooter(): void {
        this.imageFooterEl.empty();

        this.attachedImages.forEach((image, index) => {
            const tag = this.imageFooterEl.createDiv({ cls: 'ai-chat-attached-tag' });

            tag.createEl('span', {
                text: image.fileName,
                cls: 'ai-chat-attached-name'
            });

            const removeBtn = tag.createEl('button', {
                text: '✖',
                cls: 'ai-chat-attached-remove',
                attr: { title: 'Удалить изображение' }
            });
            removeBtn.addEventListener('click', async () => {
                await this.plugin.imageHandler.deleteImage(image.fileName);
                this.attachedImages.splice(index, 1);
                this.refreshImageFooter();
            });
        });
    }

    private renderWelcome(): void {
        const welcome = this.messagesContainer.createDiv({ cls: 'ai-chat-welcome' });
        welcome.createEl('p', { text: '👋 Привет! Чем могу помочь?' });
    }
    private async renderMessage(message: ChatMessage): Promise<void> {
        const msgEl = this.messagesContainer.createDiv({
            cls: `ai-chat-message ai-chat-message-\${message.role}`
        });

        const msgHeader = msgEl.createDiv({ cls: 'ai-chat-message-header' });
        msgHeader.createEl('span', {
            text: message.role === 'user' ? '👨 Вопрос пользователя' : '👽️ Ответ AI помощника',
            cls: 'ai-chat-message-role'
        });
        msgHeader.createEl('span', {
            text: this.formatTime(message.timestamp),
            cls: 'ai-chat-message-time'
        });

        const msgBody = msgEl.createDiv({ cls: 'ai-chat-message-body' });

        await MarkdownRenderer.render(
            this.app,
            message.content,
            msgBody,
            '',
            this
        );

        // Тег с именем файла — после текста вопроса
        if (message.imageFileName) {
            const imageTag = msgBody.createDiv({ cls: 'ai-chat-attached-tag ai-chat-attached-tag--sent' });
            imageTag.createEl('span', { text: '📎 ' });
            imageTag.createEl('span', {
                text: message.imageFileName,
                cls: 'ai-chat-attached-name'
            });
        }

        if (message.role === 'assistant') {
            this.renderMessageActions(msgEl, message);
        }

        this.scrollToBottom();
    }

    private renderSuggestions(suggestions: string[]): void {
        if (!suggestions || suggestions.length === 0) return;

        const suggestionsEl = this.messagesContainer.createDiv({ cls: 'ai-chat-suggestions' });

        suggestionsEl.createEl('span', {
            text: 'Возможно, тебя интересует:',
            cls: 'ai-chat-suggestions-label'
        });

        for (const suggestion of suggestions) {
            const btn = suggestionsEl.createEl('button', {
                text: suggestion,
                cls: 'ai-chat-suggestion-btn'
            });
            btn.addEventListener('click', () => {
                suggestionsEl.remove();
                this.inputEl.value = suggestion;
                this.handleSend();
            });
        }

        this.scrollToBottom();
    }

    private renderMessageActions(container: HTMLElement, message: ChatMessage): void {
        const actions = container.createDiv({ cls: 'ai-chat-message-actions' });

        const insertBtn = actions.createEl('button', {
            text: 'Вставить в заметку',
            cls: 'ai-chat-action-btn'
        });
        insertBtn.addEventListener('click', () => this.insertToNote(message.content));

        const newNoteBtn = actions.createEl('button', {
            text: 'Новая заметка',
            cls: 'ai-chat-action-btn'
        });
        newNoteBtn.addEventListener('click', () => this.createNewNote(message.content));

        const copyBtn = actions.createEl('button', {
            text: 'Копировать',
            cls: 'ai-chat-action-btn'
        });
        copyBtn.addEventListener('click', async () => {
            await navigator.clipboard.writeText(message.content);
            new Notice('✅ Скопировано в буфер обмена');
        });

        const deleteBtn = actions.createEl('button', {
            text: 'Удалить',
            cls: 'ai-chat-action-btn'
        });
        deleteBtn.addEventListener('click', async () => {
            const prevEl = container.previousElementSibling;
            const nextEl = container.nextElementSibling;

            const index = this.messages.indexOf(message);
            if (index !== -1) {
                this.messages.splice(index, 1);
                if (index > 0 && this.messages[index - 1]?.role === 'user') {
                    this.messages.splice(index - 1, 1);
                }
            }

            if (nextEl?.classList.contains('ai-chat-suggestions')) {
                nextEl.remove();
            }

            if (prevEl?.classList.contains('ai-chat-message-user')) {
                prevEl.remove();
            }

            container.remove();

            if (this.messages.length === 0) {
                if (this.currentSession) {
                    await this.plugin.sessionManager.delete(this.currentSession.id);
                }
                await this.startNewSession();
                return;
            }

            if (this.currentSession) {
                this.currentSession.messages = this.messages;
                await this.plugin.sessionManager.save(this.currentSession);
            }
        });
    }

    private renderReport(report: SourceReport[]): void {
        const reportEl = this.messagesContainer.createDiv({ cls: 'ai-chat-report' });

        const header = reportEl.createEl('div', { cls: 'ai-chat-report-header' });
        header.createEl('span', { text: '📋 Источники' });
        const toggle = header.createEl('span', {
            text: ' ▼',
            cls: 'ai-chat-report-toggle'
        });

        const body = reportEl.createDiv({ cls: 'ai-chat-report-body' });

        for (const item of report) {
            const row = body.createDiv({ cls: 'ai-chat-report-row' });

            const icon = item.type === 'link' ? '🌐' : '🔍';
            const status = item.success ? '✅' : '❌';
            const title = item.title ?? item.url;

            row.createEl('span', { text: `${icon} ${status} `, cls: 'ai-chat-report-status' });
            row.createEl('a', {
                text: title,
                cls: 'ai-chat-report-link',
                attr: { href: item.url, target: '_blank' }
            });

            if (!item.success && item.error) {
                row.createEl('span', {
                    text: ` — ${item.error}`,
                    cls: 'ai-chat-report-error'
                });
            }
        }

        header.addEventListener('click', () => {
            const isHidden = body.style.display === 'none';
            body.style.display = isHidden ? 'block' : 'none';
            toggle.textContent = isHidden ? ' ▼' : ' ▶';
        });

        this.scrollToBottom();
    }

    private async handleSend(): Promise<void> {
        const text = this.inputEl.value.trim();
        if (!text && this.attachedImages.length === 0) return;

        this.inputEl.value = '';

        this.messagesContainer.querySelector('.ai-chat-suggestions')?.remove();

        // Берём имя файла первого прикреплённого изображения
        const imageFileName = this.attachedImages[0]?.fileName;

        const userMessage: ChatMessage = {
            role: 'user',
            content: text,
            timestamp: new Date(),
            imageFileName
        };
        this.messages.push(userMessage);
        await this.renderMessage(userMessage);

        // Очищаем прикреплённые изображения после отправки
        this.attachedImages = [];
        this.refreshImageFooter();

        this.setLoading(true);

        const loadLinks = this.loadLinksCheckbox.checked;
        const doSearch = this.searchCheckbox.checked;

        this.loadLinksCheckbox.checked = false;
        this.searchCheckbox.checked = false;

        const result = await this.plugin.aiClient.sendMessage(this.messages, loadLinks, doSearch);

        this.setLoading(false);
        this.inputEl.focus();

        if (result.success) {
            const assistantMessage: ChatMessage = {
                role: 'assistant',
                content: result.content,
                timestamp: new Date()
            };
            this.messages.push(assistantMessage);
            await this.renderMessage(assistantMessage);

            if (result.report.length > 0) {
                this.renderReport(result.report);
            }

            this.renderSuggestions(result.suggestions);

            if (this.currentSession) {
                this.currentSession.messages = this.messages;
                this.currentSession.lastSuggestions = result.suggestions;
                await this.plugin.sessionManager.save(this.currentSession);
                await this.refreshSessionList();
            }
        }
    }

    private setLoading(isLoading: boolean): void {
        this.sendButton.disabled = isLoading;
        this.inputEl.disabled = isLoading;
        this.sendButton.textContent = isLoading ? 'Жду ответа...' : 'Отправить';

        if (isLoading) {
            const loader = this.messagesContainer.createDiv({ cls: 'ai-chat-loader' });
            loader.textContent = '⏳ AI думает...';
        } else {
            this.messagesContainer.querySelector('.ai-chat-loader')?.remove();
        }
    }

    private clearHistory(): void {
        this.messages = [];
        this.messagesContainer.empty();
        this.renderWelcome();
        new Notice('🗑️ История очищена');
    }

    private scrollToBottom(): void {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }

    private formatTime(date: Date): string {
        return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }

    private async insertToNote(content: string): Promise<void> {
        const editor = this.lastEditor ??
            this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;

        if (editor) {
            const cursor = editor.getCursor();
            editor.replaceRange('\n\n' + content, cursor);
            new Notice('✅ Вставлено в позицию курсора');
            return;
        }

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('❌ Нет открытой заметки');
            return;
        }

        const existing = await this.app.vault.read(activeFile);
        await this.app.vault.modify(activeFile, existing + '\n\n' + content);
        new Notice('✅ Вставлено в конец заметки');
    }

    private async createNewNote(content: string): Promise<void> {
        try {
            const now = new Date();

            const pad = (n: number) => n.toString().padStart(2, '0');
            const datePart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
            const timePart = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
            const fileName = `AI Note ${datePart} ${timePart}.md`;

            const existing = this.app.vault.getAbstractFileByPath(fileName);
            if (existing) {
                new Notice('⚠️ Файл с таким именем уже существует');
                return;
            }

            const file = await this.app.vault.create(fileName, content);
            const leaf = this.app.workspace.getLeaf('tab');
            await leaf.openFile(file);

            new Notice(`✅ Создана заметка: ${fileName}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            new Notice(`❌ Ошибка создания заметки: ${message}`);
        }
    }

    private async refreshSessionList(): Promise<void> {
        if (!this.sessionListEl) return;
        const sessions = await this.plugin.sessionManager.loadAll();

        this.sessionListEl.empty();

        for (const session of sessions) {
            const opt = this.sessionListEl.createEl('option', {
                text: session.title,
                attr: { value: session.id }
            });
            if (this.currentSession && session.id === this.currentSession.id) {
                opt.selected = true;
            }
        }
    }

    private async switchToSession(session: ChatSession): Promise<void> {
        this.currentSession = session;
        this.messages = session.messages.map(m => ({
            ...m,
            timestamp: new Date(m.timestamp)
        }));

        this.messagesContainer.empty();

        if (this.messages.length === 0) {
            this.renderWelcome();
        } else {
            for (const message of this.messages) {
                await this.renderMessage(message);
            }
            if (session.lastSuggestions && session.lastSuggestions.length > 0) {
                this.renderSuggestions(session.lastSuggestions);
            }
        }

        this.scrollToBottom();
    }

    private async startNewSession(): Promise<void> {
        this.currentSession = await this.plugin.sessionManager.createNew();
        this.messages = [];
        this.messagesContainer.empty();
        this.renderWelcome();
        await this.refreshSessionList();
    }

    private async deleteCurrentSession(): Promise<void> {
        if (!this.currentSession) return;

        await this.plugin.sessionManager.delete(this.currentSession.id);

        const sessions = await this.plugin.sessionManager.loadAll();
        const first = sessions[0];
        if (first) {
            await this.switchToSession(first);
        } else {
            await this.startNewSession();
        }
        await this.refreshSessionList();
    }

    public updateModelLabel(model: string): void {
        const label = this.containerEl.querySelector('.ai-chat-model-label');
        if (label) {
            label.textContent = model || 'модель не выбрана';
        }
    }
}
