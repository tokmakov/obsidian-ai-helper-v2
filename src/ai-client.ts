import { Notice } from 'obsidian';
import { AIPluginSettings, ChatMessage } from './types';
import { Logger } from './logger';
import { WebReader } from './web-reader';

export type AIResult =
    | { success: true; content: string; suggestions: string[] }
    | { success: false; retryable?: boolean };

export class AIClient {
    private settings: AIPluginSettings;
    private logger: Logger;
    private webReader: WebReader;

    constructor(settings: AIPluginSettings, logger: Logger) {
        this.settings = settings;
        this.logger = logger;
        this.webReader = new WebReader();
    }

    updateSettings(settings: AIPluginSettings): void {
        this.settings = settings;
    }

    private parseSuggestions(raw: string): { content: string; suggestions: string[] } {
        // Ищем блок из трех подсказок в самом конце ответа, они
        // должны идти подряд, разделённые только переносами строк
        const blockPattern = /(\{[^}]+\}\s*\n\s*){2}\{[^}]+\}\s*$/;
        const blockMatch = raw.match(blockPattern);

        if (!blockMatch) {
            return { content: raw.trim(), suggestions: [] };
        }

        // Извлекаем отдельные вопросы из найденного блока
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

    async sendMessage(messages: ChatMessage[]): Promise<AIResult> {
        // Проверяем есть ли ссылки в последнем сообщении пользователя
        const lastMessage = messages[messages.length - 1];

        if (lastMessage?.role === 'user') {
            const context = await this.webReader.buildContext(lastMessage.content);

            if (context) {
                new Notice('🌐 Загружаю содержимое ссылок...');
                const messagesWithContext = [...messages];
                messagesWithContext[messagesWithContext.length - 1] = {
                    ...lastMessage,
                    content: `${lastMessage.content}\n\n---\nКонтекст из ссылок:\n\n${context}`
                };
                return this.sendWithRetry(messagesWithContext);
            }
        }

        return this.sendWithRetry(messages);
    }

    private async sendWithRetry(messages: ChatMessage[]): Promise<AIResult> {
        const MAX_RETRIES = 5;
        const RETRY_DELAY_MS = 1000;

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            const result = await this.trySendMessage(messages);

            if (result.success) return result;

            // Повторяем только при сетевых ошибках
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
            const bodyStr = JSON.stringify(payload);
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
            return { success: false };
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
            return { success: true, content, suggestions };

        } catch (error) {
            await this.logger.error('Ошибка парсинга ответа', error);
            new Notice('❌ Не удалось разобрать ответ сервера — подробности в логах');
            return { success: false };
        }
    }
}
