import { Command } from "./Command";

export class ConnectionOptions {
    botName: string;
    vmName: string;
    prefix: string;
    commands: Command[];
};