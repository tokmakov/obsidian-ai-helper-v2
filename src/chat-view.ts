import { ItemView, WorkspaceLeaf, MarkdownRenderer, Notice, MarkdownView, Editor } from 'obsidian';
import { ChatMessage } from './types';
import AIHelperPlugin from './main';
import { ChatSession } from './session-manager';

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

    constructor(leaf: WorkspaceLeaf, plugin: AIHelperPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string { return CHAT_VIEW_TYPE; }
    getDisplayText(): string { return 'AI Helper v2'; }
    getIcon(): string { return 'message-square'; }

    async onOpen(): Promise<void> {
        this.buildUI();

        // Загружаем последнюю сессию или создаём новую
        await this.loadOrCreateSession();

        // Запоминаем редактор, чтобы вставить ответ AI-помощника
        // из чата в позицию курсора этого радактора
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

    // Шапка панели диалога с AI-помощником
    private buildHeader(container: HTMLElement): void {
        // Состоит из двух рядов — верхнего и нижнего
        const header = container.createDiv({ cls: 'ai-chat-header' });

        // Верхний ряд — заголовок, модель, кнопки
        const headerTop = header.createDiv({ cls: 'ai-chat-header-top' });

        headerTop.createEl('span', {
            text: '👽️ AI Helper v2',
            cls: 'ai-chat-title'
        });

        headerTop.createEl('span', {
            text: this.plugin.settings.model || 'модель не выбрана',
            cls: 'ai-chat-model-label'
        });

        // Кнопка создания нового диалога
        const newBtn = headerTop.createEl('button', {
            text: '➕',
            cls: 'ai-chat-clear-btn',
            attr: { title: 'Создать новый чат' }
        });
        newBtn.addEventListener('click', () => this.startNewSession());

        // Кнопка удаления текущего диалога
        const clearBtn = headerTop.createEl('button', {
            text: '🗑️',
            cls: 'ai-chat-clear-btn',
            attr: { title: 'Удалить текущий чат' }
        });
        clearBtn.addEventListener('click', () => this.deleteCurrentSession());

        // Кнопка закрытия панели диалога
        const closeBtn = headerTop.createEl('button', {
            text: '✖️',
            cls: 'ai-chat-clear-btn',
            attr: { title: 'Закрыть панель чата' }
        });
        closeBtn.addEventListener('click', () => this.leaf.detach());

        // Нижний ряд — список сессий на всю ширину
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

        const inputFooter = inputArea.createDiv({ cls: 'ai-chat-input-footer' });

        inputFooter.createEl('span', {
            text: 'Ctrl+Enter для отправки',
            cls: 'ai-chat-hint'
        });

        this.sendButton = inputFooter.createEl('button', {
            text: 'Отправить',
            cls: 'ai-chat-send-btn'
        });
        this.sendButton.addEventListener('click', () => this.handleSend());
    }

    private renderWelcome(): void {
        const welcome = this.messagesContainer.createDiv({ cls: 'ai-chat-welcome' });
        welcome.createEl('p', { text: '👋 Привет! Чем могу помочь?' });
    }

    private async renderMessage(message: ChatMessage): Promise<void> {
        const msgEl = this.messagesContainer.createDiv({
            cls: `ai-chat-message ai-chat-message-${message.role}`
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

        if (message.role === 'assistant') {
            this.renderMessageActions(msgEl, message);
        }

        this.scrollToBottom();
    }

    // вараинты вопросов, которые мог бы задать пользователь
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
                // Удаляем блок подсказок
                suggestionsEl.remove();
                // Вставляем текст в поле ввода и отправляем
                this.inputEl.value = suggestion;
                this.handleSend();
            });
        }

        this.scrollToBottom();
    }

    // четыре кнопки под ответом помощника
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
            // Сохраняем ссылки до удаления из DOM
            const prevEl = container.previousElementSibling;
            const nextEl = container.nextElementSibling;

            // Находим индекс сообщения и удаляем из массива
            const index = this.messages.indexOf(message);
            if (index !== -1) {
                // Удаляем ответ AI помощника
                this.messages.splice(index, 1);
                // Удаляем вопрос пользователя
                if (index > 0 && this.messages[index - 1]?.role === 'user') {
                    this.messages.splice(index - 1, 1);
                }
            }

            // Удаляем подсказки после ответа если есть
            if (nextEl?.classList.contains('ai-chat-suggestions')) {
                nextEl.remove();
            }

            // Удаляем вопрос пользователя перед ответом
            if (prevEl?.classList.contains('ai-chat-message-user')) {
                prevEl.remove();
            }

            // Удаляем сам ответ AI помощника
            container.remove();

            // Если не осталось вопросов и ответов — удаляем сессию и создаём новую
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

    private async handleSend(): Promise<void> {
        const text = this.inputEl.value.trim();
        if (!text) return;

        this.inputEl.value = '';

        // Удаляем старые подсказки если есть
        this.messagesContainer.querySelector('.ai-chat-suggestions')?.remove();

        const userMessage: ChatMessage = {
            role: 'user',
            content: text,
            timestamp: new Date()
        };
        this.messages.push(userMessage);
        await this.renderMessage(userMessage);

        this.setLoading(true);

        const result = await this.plugin.aiClient.sendMessage(this.messages);

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

            // Показываем подсказки под ответом
            this.renderSuggestions(result.suggestions);

            // Автосохранение сессии
            if (this.currentSession) {
                this.currentSession.messages = this.messages;
                this.currentSession.lastSuggestions = result.suggestions;
                await this.plugin.sessionManager.save(this.currentSession);
                await this.refreshSessionList();
            }
        }

        // Если !result.success — Notice уже показан в ai-client.ts
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
        // Сначала пробуем последний запомненный редактор
        // и вставляем в позицию курсора
        const editor = this.lastEditor ??
            this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;

        if (editor) {
            const cursor = editor.getCursor();
            editor.replaceRange('\n\n' + content, cursor);
            new Notice('✅ Вставлено в позицию курсора');
            return;
        }

        // Иначе — вставляем в конец файла
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

            // Формируем имя файла без запрещённых символов
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
            // Восстанавливаем подсказки последнего ответа
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
