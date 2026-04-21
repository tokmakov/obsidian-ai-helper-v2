import { Notice } from 'obsidian';
import { AIPluginSettings, ChatMessage, SourceReport } from './types';
import { Logger } from './logger';
import { WebReader } from './web-reader';
import { WebSearch, SearchResult } from './web-search';

export type AIResult =
    | { success: true; content: string; suggestions: string[]; report: SourceReport[] }
    | { success: false; retryable?: boolean };

export class AIClient {
    private settings: AIPluginSettings;
    private logger: Logger;
    private webReader: WebReader;
    private webSearch: WebSearch;

    constructor(settings: AIPluginSettings, logger: Logger) {
        this.settings = settings;
        this.logger = logger;
        this.webReader = new WebReader(this.settings, this.logger);
        this.webSearch = new WebSearch();
    }

    updateSettings(settings: AIPluginSettings): void {
        this.settings = settings;
        this.webReader.updateSettings(settings);
    }

    private parseSuggestions(raw: string): { content: string; suggestions: string[] } {
        const blockPattern = /(\{[^}]+\}\s*\n\s*){2}\{[^}]+\}\s*$/;
        const blockMatch = raw.match(blockPattern);

        if (!blockMatch) {
            return { content: raw.trim(), suggestions: [] };
        }

        const block = blockMatch[0];
        const suggestions: string[] = [];
        const pattern = /\{([^}]+)\}/g;
        let match;
        while ((match = pattern.exec(block)) !== null) {
            const suggestion = match[1];
            if (suggestion) {
                suggestions.push(suggestion.trim());
            }
        }

        const content = raw.slice(0, raw.length - block.length).trim();
        return { content, suggestions };
    }

    async sendMessage(
        messages: ChatMessage[],
        loadLinks: boolean,
        doSearch: boolean
    ): Promise<AIResult> {
        const report: SourceReport[] = [];

        // Ограничиваем контекст — берём последние N сообщений
        const limit = this.settings.contextLimit ?? 20;
        const trimmed = messages.slice(-limit);

        const lastMessage = trimmed[trimmed.length - 1];

        if (lastMessage?.role === 'user') {

            // Приоритет 1 — загружаем ссылки если чекбокс установлен
            if (loadLinks) {
                const urls = this.webReader.extractUrls(lastMessage.content);

                if (urls.length > 0) {
                    new Notice('🌐 Загружаю содержимое ссылок...');
                    const parts: string[] = [];

                    for (const url of urls) {
                        const result = await this.webReader.readUrl(url);
                        if (result.success) {
                            report.push({ type: 'link', url, title: result.title, success: true });
                            parts.push([
                                `## \${result.title}`,
                                `**Источник:** \${url}`,
                                `---`,
                                result.markdown
                            ].join('\n\n'));
                        } else {
                            report.push({ type: 'link', url, success: false, error: result.error });
                        }
                    }

                    if (parts.length > 0) {
                        const context = parts.join('\n\n---\n\n');
                        const withContext = [...trimmed];
                        withContext[withContext.length - 1] = {
                            ...lastMessage,
                            content: `\${lastMessage.content}\n\n---\nКонтекст из ссылок:\n\n\${context}`
                        };
                        const result = await this.sendWithRetry(withContext);
                        if (result.success) return { ...result, report };
                        return result;
                    }
                }
            }

            // Приоритет 2 — поиск в Яндексе если чекбокс установлен
            if (doSearch && this.settings.yandexApiKey && this.settings.yandexFolderId) {
                new Notice('🔍 Ищу в интернете (Яндекс)...');
                try {
                    const searchResults = await this.webSearch.searchYandex(
                        lastMessage.content,
                        { apiKey: this.settings.yandexApiKey, folderId: this.settings.yandexFolderId }
                    );

                    if (searchResults.length > 0) {
                        const parts: string[] = [];

                        for (const sr of searchResults.slice(0, this.settings.searchResultsLimit)) {
                            const pageResult = await this.webReader.readUrl(sr.url);
                            if (pageResult.success) {
                                report.push({ type: 'search', url: sr.url, title: pageResult.title, success: true });
                                parts.push([`### \${pageResult.title}`, sr.url, pageResult.markdown].join('\n\n'));
                            } else {
                                report.push({ type: 'search', url: sr.url, title: sr.title, success: false, error: pageResult.error });
                                parts.push(`### \${sr.title}\n\${sr.url}\n\${sr.snippet}`);
                            }
                        }

                        const searchContext = parts.join('\n\n---\n\n');
                        const withContext = [...trimmed];
                        withContext[withContext.length - 1] = {
                            ...lastMessage,
                            content: `\${lastMessage.content}\n\n---\nРезультаты поиска в интернете:\n\n\${searchContext}`
                        };
                        const result = await this.sendWithRetry(withContext);
                        if (result.success) return { ...result, report };
                        return result;
                    }
                } catch (error) {
                    await this.logger.error('Ошибка поиска', error);
                    new Notice('⚠️ Поиск не удался, отвечаю без интернета');
                }
            }
        }

        const result = await this.sendWithRetry(trimmed);
        if (result.success) return { ...result, report };
        return result;
    }

    private async sendWithRetry(messages: ChatMessage[]): Promise<AIResult> {
        const MAX_RETRIES = 5;
        const RETRY_DELAY_MS = 1000;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            const result = await this.trySendMessage(messages);

            if (result.success) return result;

            if (result.retryable && attempt < MAX_RETRIES) {
                new Notice(`⏳ Соединение прервано, повтор...`);
                await this.logger.info(`Попытка ${attempt} не удалась, повторяем через ${RETRY_DELAY_MS} мс...`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                continue;
            }

            return result;
        }

        return { success: false };
    }

    async trySendMessage(messages: ChatMessage[]): Promise<AIResult> {
        const { apiKey, baseUrl, model } = this.settings;

        if (!apiKey) {
            new Notice('⚠️ API Key не указан — зайди в настройки плагина');
            return { success: false };
        }
        if (!model) {
            new Notice('⚠️ Модель не выбрана — зайди в настройки плагина');
            return { success: false };
        }
        if (!baseUrl) {
            new Notice('⚠️ Base URL не указан — зайди в настройки плагина');
            return { success: false };
        }

        const cleanMessages = messages.map(m => ({
            role: m.role,
            content: String(m.content).trim()
        }));

        const payload = {
            model,
            messages: [
                {
                    role: 'system',
                    content: [
                        'Ты полезный AI-ассистент, встроенный в Obsidian — это база знаний для хранения заметок.',
                        'После основного ответа предложи три варианта следующего вопроса от лица пользователя.',
                        'Вопросы должны быть сформулированы от первого лица, как будто их задаёт пользователь.',
                        'Формат строго следующий — три вопроса в фигурных скобках, каждый на новой строке:',
                        '{Как установить Git на Ubuntu?}',
                        '{Чем отличается rebase от merge?}',
                        '{Как откатить последний коммит?}'
                    ].join('\n')
                },
                ...cleanMessages
            ]
        };

        await this.logger.request(payload);

        let response: Response;
        try {
            response = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'Connection': 'close'
                },
                body: JSON.stringify(payload)
            });
        } catch (error) {
            await this.logger.error('Сетевая ошибка', error);
            new Notice('❌ Не удалось подключиться к серверу — подробности в логах');
            return { success: false, retryable: true };
        }

        if (!response.ok) {
            let details = '';
            try {
                const body = await response.json();
                details = body?.error?.message ?? JSON.stringify(body);
            } catch {
                details = await response.text();
            }
            await this.logger.error('Ошибка HTTP', { status: response.status, details });
            new Notice(`❌ Ошибка сервера ${response.status} — подробности в логах`);
            const retryable = response.status === 429 || response.status === 503;
            return { success: false, retryable };
        }

        try {
            const data = await response.json();
            await this.logger.response(data);

            const raw = data?.choices?.[0]?.message?.content;
            if (!raw) {
                await this.logger.error('Пустой ответ от сервера', data);
                new Notice('⚠️ Сервер вернул пустой ответ — попробуй другую модель');
                return { success: false };
            }

            const { content, suggestions } = this.parseSuggestions(raw);
            // report здесь пустой — он формируется в sendMessage
            return { success: true, content, suggestions, report: [] };

        } catch (error) {
            await this.logger.error('Ошибка парсинга ответа', error);
            new Notice('❌ Не удалось разобрать ответ сервера — подробности в логах');
            return { success: false };
        }
    }
}
