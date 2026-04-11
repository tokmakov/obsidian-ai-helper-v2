import { requestUrl } from 'obsidian';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { AIPluginSettings } from './types';

export type WebReaderResult =
    | { success: true; title: string; url: string; markdown: string }
    | { success: false; url: string; error: string };

export class WebReader {
    private turndown: TurndownService;
    private settings: AIPluginSettings;

    constructor(settings: AIPluginSettings) {
        this.settings = settings;
        this.turndown = new TurndownService({
            codeBlockStyle: 'fenced',
            headingStyle: 'atx'
        });
    }

    updateSettings(settings: AIPluginSettings): void {
        this.settings = settings;
    }

    private async applyProxy(): Promise<string | null> {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { session } = require('electron').remote ?? require('@electron/remote');
            const current = await session.defaultSession.resolveProxy('https://example.com');
            await session.defaultSession.setProxy({
                proxyRules: this.settings.proxyUrl
            });
            console.log('[WebReader] Прокси установлен:', this.settings.proxyUrl);
            return current;
        } catch (error) {
            console.log('[WebReader] Не удалось установить прокси:', error);
            return null;
        }
    }

    private async restoreProxy(previous: string | null): Promise<void> {
        if (previous === null) return;
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { session } = require('electron').remote ?? require('@electron/remote');
            await session.defaultSession.setProxy({
                proxyRules: previous === 'DIRECT' ? '' : previous
            });
            console.log('[WebReader] Прокси восстановлен:', previous);
        } catch (error) {
            console.log('[WebReader] Не удалось восстановить прокси:', error);
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
        let previousProxy: string | null = null;

        try {
            // Включаем прокси если настроен
            if (this.settings.proxyEnabled && this.settings.proxyUrl) {
                previousProxy = await this.applyProxy();
            }

            console.log('[WebReader] Загружаю:', url);

            const response = await requestUrl({
                url,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });

            console.log('[WebReader] Статус:', response.status);

            if (response.status !== 200) {
                return { success: false, url, error: `HTTP ${response.status}` };
            }

            const html = response.text;
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            const reader = new Readability(doc);
            const article = reader.parse();

            if (!article || !article.content) {
                return { success: false, url, error: 'Не удалось выделить контент страницы' };
            }

            const markdown = this.turndown.turndown(article.content);

            const rawTitle = article.title ?? url;
            const title = (() => {
                try {
                    const bytes = Uint8Array.from(
                        rawTitle.split('').map((c: string) => c.charCodeAt(0))
                    );
                    return new TextDecoder('utf-8').decode(bytes);
                } catch {
                    return rawTitle;
                }
            })();

            return {
                success: true,
                title,
                url,
                markdown: markdown.substring(0, 20000)
            };

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.log('[WebReader] Ошибка:', message);
            return { success: false, url, error: message };
        } finally {
            // Восстанавливаем прокси в любом случае
            await this.restoreProxy(previousProxy);
        }
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
