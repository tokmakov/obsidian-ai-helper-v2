import { requestUrl } from 'obsidian';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';

export type WebReaderResult =
    | { success: true; title: string; url: string; markdown: string }
    | { success: false; url: string; error: string };

export class WebReader {
    private turndown: TurndownService;

    constructor() {
        this.turndown = new TurndownService({
            codeBlockStyle: 'fenced',
            headingStyle: 'atx'
        });
    }

    extractUrls(text: string): string[] {
        const urlPattern = /https?:\/\/[^\s]+/g;
        return text.match(urlPattern) ?? [];
    }

    async readUrl(url: string): Promise<WebReaderResult> {
        try {
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

            return {
                success: true,
                title: article.title ?? url,
                url,
                markdown: markdown.substring(0, 20000)
            };

        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.log('[WebReader] Ошибка:', message);
            return { success: false, url, error: message };
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
