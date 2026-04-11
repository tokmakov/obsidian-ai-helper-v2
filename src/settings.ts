import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import AIHelperPlugin from './main';

export class AISettingTab extends PluginSettingTab {
    plugin: AIHelperPlugin;
    private searchQuery: string = '';

    constructor(app: App, plugin: AIHelperPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'AI Helper — Настройки' });

        containerEl.createEl('h4', { text: 'Агрегатор LLM моделей' });

        new Setting(containerEl)
            .setName('Base URL агрегатора LLM')
            .setDesc('Базовый адрес API агрегатора LLM моделей')
            .addText(text => text
                .setPlaceholder('https://routerai.ru/api/v1')
                .setValue(this.plugin.settings.baseUrl)
                .onChange(async (value) => {
                    this.plugin.settings.baseUrl = value.trim();
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('API Key агрегатора LLM')
            .setDesc('Ключ доступа к API агрегатора LLM моделей')
            .addText(text => {
                text
                    .setPlaceholder('sk-...')
                    .setValue(this.plugin.settings.apiKey)
                    .onChange(async (value) => {
                        this.plugin.settings.apiKey = value.trim();
                        await this.plugin.saveSettings();
                    });
                text.inputEl.type = 'password';
            });

        // --- Поиск в интернете ---
        containerEl.createEl('h3', { text: 'Поиск в интернете' });

        new Setting(containerEl)
            .setName('Включить поиск')
            .setDesc('Включить возможность поиска через Яндекс')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.searchEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.searchEnabled = value;
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Яндекс API Key')
            .setDesc('Ключ сервисного аккаунта Яндекс Cloud')
            .addText(text => {
                text
                    .setPlaceholder('AQVNyl...')
                    .setValue(this.plugin.settings.yandexApiKey)
                    .onChange(async (value) => {
                        this.plugin.settings.yandexApiKey = value.trim();
                        await this.plugin.saveSettings();
                    });
                text.inputEl.type = 'password';
            });

        new Setting(containerEl)
            .setName('Яндекс Folder ID')
            .setDesc('Идентификатор каталога в Яндекс Cloud')
            .addText(text => text
                .setPlaceholder('b1g...')
                .setValue(this.plugin.settings.yandexFolderId)
                .onChange(async (value) => {
                    this.plugin.settings.yandexFolderId = value.trim();
                    await this.plugin.saveSettings();
                })
            );

        containerEl.createEl('h4', { text: 'Прочие настройки' });

        // Хранение сессий
        new Setting(containerEl)
            .setName('Хранить сессии, дней')
            .setDesc(`Текущее значение — ${this.plugin.settings.sessionsRetentionDays}`)
            .addSlider(slider => slider
                .setLimits(10, 1000, 1)
                .setValue(this.plugin.settings.sessionsRetentionDays)
                .onChange(async (value) => {
                    this.plugin.settings.sessionsRetentionDays = value;
                    slider.sliderEl.closest('.setting-item')
                        ?.querySelector('.setting-item-description')
                        ?.setText(`${value} дней`);
                    await this.plugin.saveSettings();
                })
            );

        new Setting(containerEl)
            .setName('Размер шрифта')
            .setDesc('Размер текста в панели чата (px)')
            .addSlider(slider => slider
                .setLimits(10, 20, 1)
                .setValue(this.plugin.settings.fontSize)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.fontSize = value;
                    await this.plugin.saveSettings();
                    // Применяем сразу без перезагрузки
                    this.plugin.applyFontSize();
                })
            );

        new Setting(containerEl)
            .setName('Логирование')
            .setDesc('Записывать запросы и ответы в лог')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.loggingEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.loggingEnabled = value;
                    await this.plugin.saveSettings();
                })
            );

        // Хранение логов
        new Setting(containerEl)
            .setName('Хранить логи, дней')
            .setDesc(`Текущее значение — ${this.plugin.settings.logsRetentionDays}`)
            .addSlider(slider => slider
                .setLimits(10, 100, 1)
                .setValue(this.plugin.settings.logsRetentionDays)
                .onChange(async (value) => {
                    this.plugin.settings.logsRetentionDays = value;
                    // Обновляем подпись в реальном времени
                    slider.sliderEl.closest('.setting-item')
                        ?.querySelector('.setting-item-description')
                        ?.setText(`${value} дней`);
                    await this.plugin.saveSettings();
                })
            );

        containerEl.createEl('h4', { text: 'Выбор LLM модели' });

        new Setting(containerEl)
            .setName('Список моделей')
            .setDesc('Загрузить актуальный список моделей с сервера')
            .addButton(button => button
                .setButtonText('Загрузить модели')
                .setCta()
                .onClick(async () => {
                    button.setButtonText('Загружаю...');
                    button.setDisabled(true);
                    const success = await this.loadModels();
                    button.setDisabled(false);
                    button.setButtonText('Загрузить модели');
                    if (success) this.display();
                })
            );

        if (this.plugin.settings.availableModels.length > 0) {
            this.renderModelSelector(containerEl);
        } else {
            containerEl.createEl('p', {
                text: '⚠️ Сначала введи API Key и нажми «Загрузить модели»',
                cls: 'setting-item-description'
            });
        }
    }

    private renderModelSelector(containerEl: HTMLElement): void {
        // --- Поле поиска ---
        new Setting(containerEl)
            .setName('Поиск модели')
            .setDesc('Фильтрует список по названию')
            .addText(text => {
                text
                    .setPlaceholder('Например: gpt, claude, gemini...')
                    .setValue(this.searchQuery)
                    .onChange((value) => {
                        this.searchQuery = value.toLowerCase();
                        // Перерисовываем только список моделей
                        modelListContainer.empty();
                        this.renderModelList(modelListContainer);
                    });
                text.inputEl.style.width = '100%';
            });

        // --- Контейнер для списка моделей ---
        const modelListContainer = containerEl.createDiv({ cls: 'ai-model-list-container' });
        this.renderModelList(modelListContainer);
    }

    private renderModelList(container: HTMLElement): void {
        const sorted = this.getSortedAndGroupedModels();
        const currentModel = this.plugin.settings.model;

        if (Object.keys(sorted).length === 0) {
            container.createEl('p', {
                text: '🔍 Ничего не найдено',
                cls: 'setting-item-description'
            });
            return;
        }

        // Рендерим по группам
        for (const [provider, models] of Object.entries(sorted)) {
            // Заголовок группы
            container.createEl('div', {
                text: provider,
                cls: 'ai-model-group-header'
            });

            // Модели в группе
            for (const model of models) {
                const isSelected = model === currentModel;

                const modelRow = container.createDiv({
                    cls: `ai-model-row ${isSelected ? 'ai-model-row-selected' : ''}`
                });

                modelRow.createEl('span', {
                    text: model,
                    cls: 'ai-model-name'
                });

                if (isSelected) {
                    modelRow.createEl('span', {
                        text: '✓',
                        cls: 'ai-model-check'
                    });
                }

                modelRow.addEventListener('click', async () => {
                    this.plugin.settings.model = model;
                    await this.plugin.saveSettings();
                    new Notice(`✅ Модель выбрана: ${model}`);
                    // Перерисовываем список чтобы обновить галочку
                    container.empty();
                    this.renderModelList(container);
                });
            }
        }
    }

    // --- Сортировка и группировка моделей ---
    private getSortedAndGroupedModels(): Record<string, string[]> {
        const query = this.searchQuery;

        // Фильтруем по поисковому запросу
        const filtered = this.plugin.settings.availableModels.filter(m =>
            m.toLowerCase().includes(query)
        );

        // Группируем по провайдеру (первая часть до '/')
        const groups: Record<string, string[]> = {};

        for (const model of filtered) {
            // Определяем провайдера из названия модели
            const provider = this.extractProvider(model);

            if (!groups[provider]) {
                groups[provider] = [];
            }
            groups[provider].push(model);
        }

        // Сортируем модели внутри каждой группы
        for (const provider of Object.keys(groups)) {
            groups[provider]?.sort((a, b) => a.localeCompare(b));
        }

        // Сортируем группы по алфавиту
        return Object.fromEntries(
            Object.entries(groups).sort(([a], [b]) => a.localeCompare(b))
        );
    }

    // --- Определяем провайдера из названия модели ---
    private extractProvider(model: string): string {
        // Формат "provider/model-name" → берём первую часть
        if (model.includes('/')) {
            return model.split('/')[0] ?? 'Другие';
        }

        // Известные префиксы без слеша
        const knownProviders: Record<string, string> = {
            'gpt': 'OpenAI',
            'o1': 'OpenAI',
            'o3': 'OpenAI',
            'claude': 'Anthropic',
            'gemini': 'Google',
            'llama': 'Meta',
            'mistral': 'Mistral',
            'mixtral': 'Mistral',
            'qwen': 'Alibaba',
            'deepseek': 'DeepSeek',
            'command': 'Cohere',
        };

        const lower = model.toLowerCase();
        for (const [prefix, provider] of Object.entries(knownProviders)) {
            if (lower.startsWith(prefix)) {
                return provider;
            }
        }

        return 'Другие';
    }

    async loadModels(): Promise<boolean> {
        const { apiKey, baseUrl } = this.plugin.settings;

        if (!apiKey || !baseUrl) {
            new Notice('❌ Заполни Base URL и API Key перед загрузкой моделей');
            return false;
        }

        try {
            const response = await fetch(`${baseUrl}/models`, {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });

            if (!response.ok) {
                new Notice(`❌ Ошибка сервера: ${response.status} ${response.statusText}`);
                return false;
            }

            const data = await response.json();
            const models: string[] = data.data.map((m: { id: string }) => m.id);

            if (models.length === 0) {
                new Notice('⚠️ Сервер вернул пустой список моделей');
                return false;
            }

            this.plugin.settings.availableModels = models;

            if (!this.plugin.settings.model) {
                this.plugin.settings.model = models[0] ?? '';
            }

            await this.plugin.saveSettings();
            new Notice(`✅ Загружено моделей: ${models.length}`);
            return true;

        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            new Notice(`❌ Не удалось подключиться: ${msg}`);
            return false;
        }
    }
}
