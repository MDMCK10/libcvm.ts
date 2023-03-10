export class Command {
    name: string;
    action: Function;
    adminOnly: boolean;
    acceptsArguments: boolean;
};