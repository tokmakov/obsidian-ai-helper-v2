import { requestUrl } from 'obsidian';

export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

export interface YandexSearchSettings {
    apiKey: string;
    folderId: string;
}

export class WebSearch {
    async searchYandex(query: string, settings: YandexSearchSettings): Promise<SearchResult[]> {
        // Шаг 1 — отправляем асинхронный запрос
        const searchResponse = await requestUrl({
            url: 'https://searchapi.api.cloud.yandex.net/v2/web/searchAsync',
            method: 'POST',
            headers: {
                'Authorization': `Api-Key ${settings.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                query: {
                    searchType: 'SEARCH_TYPE_RU',
                    queryText: query
                },
                folderId: settings.folderId
            })
        });

        const operationId = searchResponse.json.id;
        console.log('[WebSearch] Операция создана:', operationId);

        // Шаг 2 — ждём завершения операции
        const xmlData = await this.waitForOperation(operationId, settings.apiKey);

        // Шаг 3 — парсим XML и возвращаем результаты
        return this.parseXml(xmlData);
    }

    private async waitForOperation(operationId: string, apiKey: string): Promise<string> {
        for (let i = 0; i < 10; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));

            const response = await requestUrl({
                url: `https://operation.api.cloud.yandex.net/operations/${operationId}`,
                headers: { 'Authorization': `Api-Key ${apiKey}` }
            });

            const data = response.json;
            console.log('[WebSearch] Статус операции:', data.done);

            if (data.done && data.response?.rawData) {
                // Декодируем Base64 → байты → UTF-8 строка
                const base64 = data.response.rawData;
                const binaryStr = atob(base64);
                const bytes = Uint8Array.from(
                    binaryStr.split('').map((c: string) => c.charCodeAt(0))
                );
                return new TextDecoder('utf-8').decode(bytes);
            }
        }
        throw new Error('Таймаут ожидания результатов поиска');
    }


    private parseXml(xml: string): SearchResult[] {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, 'text/xml');
        const results: SearchResult[] = [];

        const docs = doc.querySelectorAll('doc');
        docs.forEach(docEl => {
            const url = docEl.querySelector('url')?.textContent ?? '';
            const title = docEl.querySelector('title')?.textContent ?? '';
            const snippet = docEl.querySelector('passage')?.textContent ??
                docEl.querySelector('extended-text')?.textContent ?? '';

            if (url && title) {
                results.push({
                    url,
                    title: title.replace(/<[^>]+>/g, ''), // убираем hlword теги
                    snippet: snippet.replace(/<[^>]+>/g, '')
                });
            }
        });

        console.log('[WebSearch] Найдено результатов:', results.length);
        return results.slice(0, 5); // топ 5
    }
}
