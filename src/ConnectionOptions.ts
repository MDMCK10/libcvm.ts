export class ConnectionOptions {
    botName: string;
    vmName: string;
    autologin: boolean = false;
    password: string;
    maxReconnectionAttempts: number = 50;

    public constructor(init?:Partial<ConnectionOptions>) {
        Object.assign(this, init);
    }
};