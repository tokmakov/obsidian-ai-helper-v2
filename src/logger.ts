import { Vault, TFile, TFolder } from 'obsidian';

export class Logger {
    private vault: Vault;
    private logsDir: string;
    private enabled: boolean;
    private logsDirReady = false;

    constructor(vault: Vault, pluginDir: string, enabled: boolean) {
        this.vault = vault;
        this.logsDir = `${pluginDir}/logs`;
        this.enabled = enabled;
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    private getLogFileName(): string {
        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        return `${this.logsDir}/${date}.log`;
    }

    private formatEntry(level: string, message: string, data?: unknown): string {
        const now = new Date();
        const time = now.toLocaleTimeString('ru-RU', {
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });

        let entry = `[${time}] [${level}] ${message}`;
        if (data !== undefined) {
            try {
                entry += '\n' + JSON.stringify(data, null, 2);
            } catch {
                entry += '\n' + String(data);
            }
        }
        return entry + '\n';
    }

    private async ensureLogsDir(): Promise<void> {
        if (this.logsDirReady) return;
        try {
            await this.vault.adapter.mkdir(this.logsDir);
        } catch {
            // Папка уже существует — всё хорошо
        }
        this.logsDirReady = true;
    }

    private async writeToFile(entry: string): Promise<void> {
        try {
            await this.ensureLogsDir();

            const filePath = this.getLogFileName();
            const adapter = this.vault.adapter;

            const exists = await adapter.exists(filePath);
            if (exists) {
                const content = await adapter.read(filePath);
                await adapter.write(filePath, content + entry);
            } else {
                await adapter.write(filePath, entry);
            }
        } catch (error) {
            console.error('Logger: не удалось записать лог:', error);
        }
    }

    async info(message: string, data?: unknown): Promise<void> {
        console.log(`[AI Helper] ${message}`, data ?? '');
        if (!this.enabled) return;
        await this.writeToFile(this.formatEntry('INFO', message, data));
    }

    async error(message: string, data?: unknown): Promise<void> {
        console.error(`[AI Helper] ${message}`, data ?? '');
        if (!this.enabled) return;
        await this.writeToFile(this.formatEntry('ERROR', message, data));
    }

    async request(payload: unknown): Promise<void> {
        if (!this.enabled) return;
        const sanitized = this.sanitizePayload(payload);
        await this.writeToFile(this.formatEntry('REQUEST', 'Отправляем запрос к API', sanitized));
    }

    private sanitizePayload(payload: unknown): unknown {
        if (!payload || typeof payload !== 'object') return payload;

        const p = payload as Record<string, unknown>;
        if (!Array.isArray(p['messages'])) return payload;

        const messages = (p['messages'] as unknown[]).map(msg => {
            if (!msg || typeof msg !== 'object') return msg;
            const m = msg as Record<string, unknown>;

            if (!Array.isArray(m['content'])) return m;

            const content = (m['content'] as unknown[]).map(part => {
                if (!part || typeof part !== 'object') return part;
                const p = part as Record<string, unknown>;

                if (p['type'] === 'image_url') {
                    return { type: 'image_url', image_url: { url: '[base64 image]' } };
                }
                return p;
            });

            return { ...m, content };
        });

        return { ...p, messages };
    }


    async response(data: unknown): Promise<void> {
        if (!this.enabled) return;
        await this.writeToFile(this.formatEntry('RESPONSE', 'Получен ответ от API', data));
    }

    async cleanOldLogs(retentionDays: number): Promise<void> {
        try {
            const adapter = this.vault.adapter;
            const exists = await adapter.exists(this.logsDir);
            if (!exists) return;

            const listing = await adapter.list(this.logsDir);
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - retentionDays);

            for (const filePath of listing.files) {
                const fileName = filePath.split('/').pop() ?? '';
                if (!fileName.endsWith('.log')) continue;

                const fileDate = new Date(fileName.replace('.log', ''));
                if (isNaN(fileDate.getTime())) continue;

                if (fileDate < cutoff) {
                    await adapter.remove(filePath);
                    console.log(`[AI Helper] Удалён старый лог: ${fileName}`);
                }
            }
        } catch (error) {
            console.error('Logger: ошибка при очистке логов:', error);
        }
    }

}
