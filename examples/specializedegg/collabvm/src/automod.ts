import EventEmitter from 'node:events';
import { User } from '../../../../dist/User';
import { VM } from '../../../..//dist/VM';
import { Encode } from '../../../../dist/Guacamole';

export enum AutoModAction {
    LOG = "Log",
    MUTE_TEMP = "Temporary Mute",
    MUTE_PERM = "Permanent Mute",
    KICK = "Kick",
    BAN = "Ban",
    RESET_USERNAME = "Reset Username"
}

type CheckFunction = (user: User, message: string, vm: VM) => boolean;

export class AutoModRule {
    // Description of automod rule
    description: string;

    // Check function, should return true if OK, or false if flagged
    check: CheckFunction;

    // Priority, higher will be executed first
    priority: number = 0;

    // Action
    action: AutoModAction = AutoModAction.LOG;

    // Stop other rules from being executed if this one flags?
    stopOthers: boolean = false;

    run(user: User, message: string, vm: VM): boolean {
        if(!this.check(user, message, vm)) {
            switch (this.action) {
                case AutoModAction.MUTE_TEMP: {
                    vm.Mute(user.username, true);
                    break;
                }
                case AutoModAction.MUTE_PERM: {
                    vm.Mute(user.username, false);
                    break;
                }
                case AutoModAction.KICK: {
                    vm.Kick(user.username);
                    break;
                }
                case AutoModAction.BAN: {
                    vm.Ban(user.username);
                    break;
                }
		case AutoModAction.RESET_USERNAME: {
		    vm.websocket.send(Encode("admin", "18", user.username, " "));
		    break;
		}
                case AutoModAction.LOG:
                default: {
                    break;
                }
            }
            return false;
        }
        return true;
    }
}

export class AutoMod {
    emitter: EventEmitter;
    rules: Array<AutoModRule> = [];

    constructor() {
        this.emitter = new EventEmitter();
    }

    evaluate(user: User, message: string, vm: VM) : Map<string, AutoModAction> {
        let hits: Map<string, AutoModAction> = new Map();
        for(const rule of this.rules.slice().sort((a,b)=>b.priority-a.priority)) {
            if(!rule.run(user, message, vm)) {
                hits.set(rule.description, rule.action);
                if(rule.stopOthers) break;
            }
        }
        return hits;
    }
}
