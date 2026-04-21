import { Vault } from 'obsidian';
import { Logger } from './logger';

export interface AttachedImage {
    fileName: string;
}

export class ImageHandler {
    private vault: Vault;
    private logger: Logger;
    private imagesDir: string;

    constructor(vault: Vault, pluginDir: string, logger: Logger) {
        this.vault = vault;
        this.logger = logger;
        this.imagesDir = `${pluginDir}/images`;
    }

    private async ensureImagesDir(): Promise<void> {
        try {
            await this.vault.adapter.mkdir(this.imagesDir);
        } catch {
            // уже существует
        }
    }

    async processClipboardImage(file: File): Promise<AttachedImage | null> {
        try {
            const bitmap = await createImageBitmap(file);

            // Масштабируем до 1280px по длинной стороне
            const MAX = 1280;
            let { width, height } = bitmap;
            if (width > MAX || height > MAX) {
                if (width >= height) {
                    height = Math.round((height / width) * MAX);
                    width = MAX;
                } else {
                    width = Math.round((width / height) * MAX);
                    height = MAX;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(bitmap, 0, 0, width, height);
            bitmap.close();

            // Сохраняем файл в vault
            const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
            await this.saveToVault(fileName, canvas);

            await this.logger.info(`[ImageHandler] Изображение сохранено: ${fileName} (${width}×${height})`);

            return { fileName };

        } catch (error) {
            await this.logger.error('[ImageHandler] Ошибка обработки изображения', error);
            return null;
        }
    }

    private async saveToVault(fileName: string, canvas: HTMLCanvasElement): Promise<void> {
        await this.ensureImagesDir();

        const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
                b => b ? resolve(b) : reject(new Error('canvas.toBlob вернул null')),
                'image/jpeg',
                0.85
            );
        });

        const arrayBuffer = await blob.arrayBuffer();

        await this.vault.adapter.writeBinary(
            `${this.imagesDir}/${fileName}`,
            arrayBuffer
        );
    }

    async deleteImage(fileName: string): Promise<void> {
        try {
            await this.vault.adapter.remove(`${this.imagesDir}/${fileName}`);
        } catch {
            // файл уже удалён или не существует
        }
    }
}
