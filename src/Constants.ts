export function CalculatePermissions(val : number) : Permissions {
    var perms: Permissions;

    if (val & 1) { perms.restore_snapshot = true; }
	if (val & 2) { perms.reboot_vm = true; }
	if (val & 4) { perms.ban_users = true; }
	if (val & 8) { perms.force_votes = true; }
	if (val & 16) { perms.mute_users = true; }
	if (val & 32) { perms.kick_users = true; }
	if (val & 64) { perms.bypass_and_end_turns = true; }
	if (val & 128) { perms.rename_users = true; }
	if (val & 256) { perms.copy_ips = true; }

    return perms;
}

export interface Permissions {
    restore_snapshot : boolean;
    reboot_vm : boolean;
    ban_users : boolean;
    force_votes : boolean;
    mute_users : boolean;
    kick_users : boolean;
    bypass_and_end_turns : boolean;
    rename_users : boolean;
    copy_ips : boolean;
    xss : boolean;
}

export enum Rank {
    Unregistered = 0,
    Admin = 2,
    Moderator = 3,
}

export let DefaultHeaders = {
    'Origin': 'https://computernewb.com/collab-vm/',
    'Host': 'computernewb.com',
    'User-Agent': 'LibCVM.ts/0.0.1 (https://github.com/MDMCK10/libcvm.ts)'
}