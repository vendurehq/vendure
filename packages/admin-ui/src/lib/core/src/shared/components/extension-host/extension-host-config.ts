export interface ExtensionHostOptions {
    extensionUrl: string;
    openInNewTab?: boolean;
}

export class ExtensionHostConfig {
    public extensionUrl: string;
    public openInNewTab: boolean;
    constructor(options: ExtensionHostOptions) {
        this.extensionUrl = options.extensionUrl;
        this.openInNewTab = options.openInNewTab != null ? options.openInNewTab : false;
    }
}
