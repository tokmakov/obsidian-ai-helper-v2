export interface AIPluginSettings {
    apiKey: string;
    baseUrl: string;
    model: string;
    availableModels: string[];
    fontSize: number;
    loggingEnabled: boolean;
    logsRetentionDays: number;
    sessionsRetentionDays: number;
    searchEnabled: boolean;
    yandexApiKey: string;
    yandexFolderId: string;
}

export const DEFAULT_SETTINGS: AIPluginSettings = {
    apiKey: '',
    baseUrl: 'https://api.ai-mediator.ru/v1',
    model: '',
    availableModels: [],
    fontSize: 13,
    loggingEnabled: false,
    logsRetentionDays: 30,
    sessionsRetentionDays: 100,
    searchEnabled: false,
    yandexApiKey: '',
    yandexFolderId: ''
}

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

export interface SourceReport {
    type: 'link' | 'search';
    url: string;
    title?: string;
    success: boolean;
    error?: string;
}
