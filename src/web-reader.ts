import { requestUrl, Notice } from 'obsidian';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { AIPluginSettings } from './types';
import { Logger } from './logger';

export type WebReaderResult =
    | { success: true; title: string; url: string; markdown: string }
    | { success: false; url: string; error: string };

export class WebReader {
    private turndown: TurndownService;
    private settings: AIPluginSettings;
    private logger: Logger;
    private proxyApplied: boolean = false;

    constructor(settings: AIPluginSettings, logger: Logger) {
        this.settings = settings;
        this.logger = logger;
        this.turndown = new TurndownService({
            codeBlockStyle: 'fenced',
            headingStyle: 'atx'
        });
    }

    updateSettings(settings: AIPluginSettings): void {
        this.settings = settings;
    }

    private async applyProxy(): Promise<void> {
        try {
            await this.logger.info(`[WebReader] Устанавливаю прокси: ${this.settings.proxyUrl}`);
            const { remote } = require('electron');
            await remote.session.defaultSession.setProxy({
                proxyRules: this.settings.proxyUrl
            });
            const after = await remote.session.defaultSession.resolveProxy('https://example.com');
            await this.logger.info(`[WebReader] Прокси установлен: ${after}`);
            this.proxyApplied = true;
            new Notice('🔄 Загружаю ссылки через прокси...');
        } catch (error) {
            await this.logger.error('[WebReader] Не удалось установить прокси', error);
        }
    }

    private async restoreProxy(): Promise<void> {
        if (!this.proxyApplied) return;
        try {
            const { remote } = require('electron');
            await remote.session.defaultSession.setProxy({ proxyRules: '' });
            this.proxyApplied = false;
            await this.logger.info('[WebReader] Прокси восстановлен');
        } catch (error) {
            await this.logger.error('[WebReader] Не удалось восстановить прокси', error);
        }
    }

    extractUrls(text: string): string[] {
        const lines = text.split('\n');
        const urls: string[] = [];
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i]!.trim();
            if (/^https?:\/\/\S+$/.test(line)) {
                urls.unshift(line);
            } else {
                break;
            }
        }
        return urls;
    }

    async readUrl(url: string): Promise<WebReaderResult> {
        const retries = this.settings.fetchRetries;
        const timeout = this.settings.fetchTimeout;

        // Попытки без прокси
        for (let i = 1; i <= retries; i++) {
            await this.logger.info(`[WebReader] Попытка ${i}/${retries} без прокси: ${url}`);
            try {
                const result = await this.fetchUrl(url, timeout);
                if (result.success) return result;
                await this.logger.info(`[WebReader] Попытка ${i} без прокси не удалась: ${result.error}`);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                await this.logger.info(`[WebReader] Попытка ${i} без прокси упала: ${message}`);
            }
        }

        // Если прокси не настроен — возвращаем ошибку
        if (!this.settings.proxyEnabled || !this.settings.proxyUrl) {
            await this.logger.info('[WebReader] Прокси не настроен, все попытки исчерпаны');
            return { success: false, url, error: 'Не удалось загрузить страницу' };
        }

        // Попытки через прокси
        new Notice('⚠️ Прямая загрузка не удалась, пробую через прокси...');
        await this.applyProxy();

        try {
            for (let i = 1; i <= retries; i++) {
                await this.logger.info(`[WebReader] Попытка ${i}/${retries} через прокси: ${url}`);
                try {
                    const result = await this.fetchUrl(url, timeout);
                    if (result.success) return result;
                    await this.logger.info(`[WebReader] Попытка ${i} через прокси не удалась: ${result.error}`);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    await this.logger.info(`[WebReader] Попытка ${i} через прокси упала: ${message}`);
                }
            }
        } finally {
            await this.restoreProxy();
        }

        return { success: false, url, error: 'Не удалось загрузить страницу ни напрямую, ни через прокси' };
    }

    private async fetchUrl(url: string, timeout: number): Promise<WebReaderResult> {
        const controller = new AbortController();
        const timer = setTimeout(() => {
            controller.abort();
            this.logger.info(`[WebReader] Таймаут ${timeout}мс истёк: ${url}`);
        }, timeout);

        try {
            const response = await requestUrl({
                url,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });

            clearTimeout(timer);
            await this.logger.info(`[WebReader] Статус: ${response.status} — ${url}`);

            if (response.status !== 200) {
                return { success: false, url, error: `HTTP ${response.status}` };
            }

            const buffer = response.arrayBuffer;
            const html = new TextDecoder('utf-8').decode(buffer);
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            const reader = new Readability(doc);
            const article = reader.parse();

            if (!article || !article.content) {
                return { success: false, url, error: 'Не удалось выделить контент страницы' };
            }

            const markdown = this.turndown.turndown(this.decodeHtmlEntities(article.content));
            const title = this.decodeHtmlEntities(article.title ?? url);

            return {
                success: true,
                title,
                url,
                markdown: markdown.substring(0, 20000)
            };

        } catch (error) {
            clearTimeout(timer);
            if (controller.signal.aborted) {
                return { success: false, url, error: `Таймаут ${timeout}мс` };
            }
            throw error;
        }
    }

    private decodeHtmlEntities(text: string): string {
        return text
            .replace(/&nbsp;/g, ' ')
            .replace(/&/g, '&')
            .replace(/</g, '<')
            .replace(/>/g, '>')
            .replace(/"/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&mdash;/g, '—')
            .replace(/&ndash;/g, '–')
            .replace(/&laquo;/g, '«')
            .replace(/&raquo;/g, '»')
            .replace(/&hellip;/g, '...');
    }

    async buildContext(text: string): Promise<string> {
        const urls = this.extractUrls(text);
        if (urls.length === 0) return '';

        const results = await Promise.all(urls.map(url => this.readUrl(url)));

        const parts: string[] = [];
        for (const result of results) {
            if (result.success) {
                parts.push([
                    `## ${result.title}`,
                    `**Источник:** ${result.url}`,
                    `---`,
                    result.markdown
                ].join('\n\n'));
            } else {
                parts.push(`## Ошибка загрузки ${result.url}\n${result.error}`);
            }
        }

        return parts.join('\n\n---\n\n');
    }
}
