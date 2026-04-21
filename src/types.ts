export interface AIPluginSettings {
    apiKey: string;
    baseUrl: string;
    model: string;
    availableModels: string[];
    contextLimit: number;
    fontSize: number;
    loggingEnabled: boolean;
    logsRetentionDays: number;
    sessionsRetentionDays: number;
    fetchTimeout: number;
    fetchRetries: number;
    searchEnabled: boolean;
    searchResultsLimit: number;
    yandexApiKey: string;
    yandexFolderId: string;
    proxyEnabled: boolean;
    proxyUrl: string;
}

export const DEFAULT_SETTINGS: AIPluginSettings = {
    apiKey: '',
    baseUrl: 'https://api.ai-mediator.ru/v1',
    model: '',
    availableModels: [],
    contextLimit: 20,
    fontSize: 13,
    loggingEnabled: false,
    logsRetentionDays: 30,
    sessionsRetentionDays: 100,
    fetchTimeout: 10000,
    fetchRetries: 3,
    searchEnabled: false,
    searchResultsLimit: 3,
    yandexApiKey: '',
    yandexFolderId: '',
    proxyEnabled: false,
    proxyUrl: ''
}

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    imageFileName?: string;
}

export interface SourceReport {
    type: 'link' | 'search';
    url: string;
    title?: string;
    success: boolean;
    error?: string;
}
