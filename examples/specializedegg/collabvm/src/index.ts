import fastifyWebsocket, { SocketStream } from '@fastify/websocket';
import { ConnectionOptions, VM } from "../../../../dist/index";
import { User } from "../../../../dist/User";
import { Rank } from "../../../../dist/Constants";
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { AutoMod, AutoModAction, AutoModRule } from "./automod";

/* config */
const botname = "Specialized Egg";
const token = "test";
const autologin = true;
/* end config */

const db = new Database('specializedegg.db');
db.pragma('journal_mode = WAL');
db.exec("CREATE TABLE IF NOT EXISTS chatlogs (username CHAR, message CHAR, timestamp TEXT, vm CHAR)");
db.exec("CREATE TABLE IF NOT EXISTS userlogs (username CHAR, ip CHAR, date TEXT, vm CHAR)");
db.function('regexp', { deterministic: true }, (regex: string, text: string) => {
    return new RegExp(regex).test(text) ? 1 : 0;
});

const insert_message = db.prepare(`INSERT INTO chatlogs(username, message, timestamp, vm) VALUES(?, ?, datetime('now'), ?)`);
const insert_user = db.prepare(`INSERT INTO userlogs(username, ip, date, vm) VALUES(?, ?, datetime('now'), ?)`);
const chatlog_query_default = db.prepare(`SELECT * FROM chatlogs ORDER BY timestamp DESC LIMIT 10`);

const autoMod = new AutoMod();
autoMod.rules.push((() => {
    let rule = new AutoModRule();
    rule.description = "Message contains names of RATs.";
    rule.check = (_, message: string, __) => {
        if(message.toLowerCase().includes("anydesk") || message.toLowerCase().includes("teamviewer")
	|| message.toLowerCase().includes("getscreen") || message.toLowerCase().includes(" rdp ")) {
            return false;
        }
        return true;
    }
    return rule;
})())

const automodTimes = new Map<User, number>();

autoMod.rules.push((() => {
    let rule = new AutoModRule();
    rule.check = (user: User, message: string, vm: VM) => {
        if(/(f!g|fag|f@g|f@9|f4g|f\/-\\g)(got|)(s|)/.test(message.toLowerCase())) {
	    if(user.rank == Rank.Admin || user.rank == Rank.Moderator) { /*vm.websocket.send(Encode("chat", `@${user.username} You Not Mute from 30 Seconds,Rules: staff`));*/ return true;  }
	    automodTimes.set(user, (automodTimes.get(user) ?? 0) + 1)
            if(automodTimes.get(user) >= 2) {
		rule.description = "Message contains a variation of \"fag\". (ESCALATION)";
		rule.action = AutoModAction.MUTE_PERM
		//vm.websocket.send(Encode("chat",`@${user.username} You Mute from 1 Year,Rules: Do not Bad Words`));
	    }else{
		rule.description = "Message contains a variation of \"fag\".";
		rule.action = AutoModAction.MUTE_TEMP
		//vm.websocket.send(Encode("chat",`@${user.username} You Mute from 30 Seconds,Rules: Do not Bad Words`));
	    }
            return false;
        }
        return true;
    }
    return rule;
})())

autoMod.rules.push((() => {
    let rule = new AutoModRule();
    rule.priority = 10;
    rule.stopOthers = true;
    rule.check = (user: User, message: string, vm: VM) => {
        if(/nig(ger|ga|gah|guh|g)(s|)/.test(message.toLowerCase())) {
	    if(user.rank == Rank.Admin || user.rank == Rank.Moderator) { /*vm.websocket.send(Encode("chat", `@${user.username} You Not Mute from 30 Seconds,Rules: staff`));*/ return true;  }
            automodTimes.set(user, (automodTimes.get(user) ?? 0) + 1)
            if(automodTimes.get(user) >= 2) {
                rule.description = "Message contains the N word. (ESCALATION)";
                rule.action = AutoModAction.MUTE_PERM
                //vm.websocket.send(Encode("chat",`@${user.username} You Mute from 1 Year,Rules: Do not Racism`));
            }else{
                rule.description = "Message contains the N word.";
                rule.action = AutoModAction.MUTE_TEMP
                //vm.websocket.send(Encode("chat",`@${user.username} You Mute from 30 Seconds,Rules: Do not Racism`));
            }
	    return false;
        }
        return true;
    }
    rule.action = AutoModAction.MUTE_TEMP
    return rule;
})())

autoMod.rules.push((() => {
    let rule = new AutoModRule();
    rule.priority = 20;
    rule.stopOthers = true;
    rule.check = (user: User, _, vm: VM) => {
        console.log(vm.options.vmName)
        if(/nig(ger|ga|gah|guh|g)(s|)/.test(user.username.toLowerCase())) {
	    if(user.rank == Rank.Admin || user.rank == Rank.Moderator) {  return true;  }
            automodTimes.set(user, (automodTimes.get(user) ?? 0) + 1)
            if(automodTimes.get(user) >= 2) {
                rule.description = "Username contains the N word. (ESCALATION)";
                rule.action = AutoModAction.MUTE_PERM
            }else{
                rule.description = "Username contains the N word.";
                rule.action = AutoModAction.RESET_USERNAME
            }
	    return false;
        }
        return true;
    }
    rule.action = AutoModAction.RESET_USERNAME
    return rule;
})())

autoMod.rules.push((() => {
    let rule = new AutoModRule();
    rule.description = "Known ban evader";
    rule.action = AutoModAction.LOG;
    rule.check = (user: User, _, vm: VM) => {
        if(user.username.toLowerCase() == "eslamomar" || user.username.toLowerCase() == "jolinho") {
	    // @ts-ignore
	    if(!user._banFlagged) {
	      // @ts-ignore
	      user._banFlagged = true;
              return false;
	    }
        }
        return true;
    }
    return rule;
})())


let vms: Array<VM> = [];
const chatlog_query_schema = {
    type: 'object',
    properties: {
      vm: { type: 'string' },
      username: { type: 'string' },
      from: { type: 'string', format: 'date-time' },
      to: { type: 'string', format: 'date-time' },
      count: { type: 'integer', minimum: 1 },
      regex: { type: 'string' },
    }
};

const mod_api_schema = {
    type: 'object',
    required: ['token'],
    properties: {
      token: { type: 'string' }
    }
}

let eventConnections : Set<SocketStream> = new Set<SocketStream>();


const fastify = Fastify({ trustProxy: true });
fastify.register(fastifyWebsocket)
fastify.register(async function (fastify) {
  fastify.get('/api/v1/mod/events', { schema: { querystring: mod_api_schema }, websocket: true }, (connection, request) => {
    if(request.query["token"] != token) { 
        connection.socket.send("Unauthorized. Provide a valid token.");
        connection.socket.close();
    }else{
	console.log(`[specializedegg/fastify/ws] (${request.ip}) Received WS connection.`);
        eventConnections.add(connection);
    }
    
    connection.socket.on('close', () => {
	console.log(`[specializedegg/fastify/ws] (${request.ip}) WS connection closed.`)
        eventConnections.delete(connection);
    });
  });
});

function HTMLDecode(input : string) : string {
    return input.replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&amp;/g, "&")
                .replace(/&quot;/g, "\"")
                .replace(/&#x27;/g, "'")
                .replace(/&#x2F;/g, "/")
                .replace(/&#13;&#10;/g, "\n");
}

fastify.get("/api/v1/vms", (request, reply) => {
    reply.send({
	status: "success",
	message: {
		...vms.map(x=>x.options.vmName).sort()
	}
    });
});

fastify.get("/api/v1/vminfo/:vm", (request, reply) => {
    const vm = vms.find(vm => vm.options.vmName == request.params["vm"]);
    if(vm === undefined) {
        reply.code(404);
        return reply.send({status: "error", message: "VM does not exist."});
    }else if(!vm.connected) {
        reply.code(503);
        return reply.send({status: "error", message: `Not connected to ${request.params["vm"].toUpperCase()}. Try again later.`});
    }

    reply.send({
        status: "success",
        message: {
            id: vm.options.vmName,
            users: vm.users,
            turnqueue: vm.turnQueue.length === 0 ? null : vm.turnQueue,
            voteinfo: vm.voteInfo.time === 0 ? null : vm.voteInfo
        }
    });
});

fastify.get("/api/v1/finduser/:user", (request, reply) => {
    let foundAt = [];
    vms.forEach(vm => {
        if(vm.users.some(user => user.username === request.params["user"])) {
            foundAt.push(vm.options.vmName);
        }
    });

    if(foundAt.length === 0) {
        reply.code(404);
        return reply.send({status: "error", message: `${request.params["user"]} not found on any VM.`});
    }

    foundAt.sort();

    reply.send({
        status: "success",
        message: {
            username: request.params["user"],
            vms: foundAt
        }
    });
});

fastify.get("/api/v1/screenshot/:vm",  (request, reply) => {
    const vm = vms.find(vm => vm.options.vmName == request.params["vm"].split('.')[0]);
    if(vm === undefined) {
        reply.code(404);
        return reply.send({status: "error", message: "VM does not exist."});
    }else if(!vm.connected) {
        reply.code(503);
        return reply.send({status: "error", message: `Not connected to ${request.params["vm"].toUpperCase()}. Try again later.`});
    }

    reply.header("Content-Type", "image/jpeg");
    return reply.send(vm.display.toBuffer("image/jpeg"));
});

fastify.get("/api/v1/chatlogs",  { schema: { querystring: chatlog_query_schema } }, (request, reply) => {
    if(Object.keys(request.query).filter(param => ['vm', 'username', 'from', 'to', 'count', 'regex'].includes(param)).length === 0) {
        let lines = chatlog_query_default.all();
        return reply.send(lines);
    } else {
        const { vm, username, from, to, count, regex }: {
            vm?: string;
            username?: string;
            from?: string;
            to?: string;
            count?: string;
            regex?: string;
        } = request.query;
        let sql = 'SELECT * FROM chatlogs WHERE 1=1';
        const params = [];

        if (vm) {
            sql += ' AND vm = ?';
            params.push(vm);
        }

        if (username) {
            sql += ' AND username = ?';
            params.push(username);
        }

        if (from) {
            sql += ' AND timestamp >= ?';
            params.push(from);
        }

        if (to) {
            sql += ' AND timestamp <= ?';
            params.push(to);
        }

        if (regex) {
            sql += ' AND message REGEXP ?';
            params.push(regex);
        }

        sql += ' ORDER BY timestamp DESC';

        if (count) {
            sql += ' LIMIT ?';
            params.push(parseInt(count));
        }

        const chatlog_query_custom = db.prepare(sql);
        let lines = chatlog_query_custom.all(params);
        return reply.send({status: "success", message: lines});
    }
});

fastify.get("/api/v1/mod/iptousername/:ip", { schema: { querystring: mod_api_schema } }, (request, reply) => {
    if(request.query["token"] != token) return reply.code(401).send({status: "error", message: "Unauthorized. Provide a valid token."});
    let query = db.prepare("SELECT * FROM userlogs WHERE ip = ?");
    let lines = query.all(request.params["ip"]);
    return reply.send({status: "success", message: lines});
});

fastify.get("/api/v1/mod/usernametoip/:username", { schema: { querystring: mod_api_schema } },  (request, reply) => {
    if(request.query["token"] != token) return reply.code(401).send({status: "error", message: "Unauthorized. Provide a valid token."});
    let query = db.prepare("SELECT * FROM userlogs WHERE username = ?");
    let lines = query.all(request.params["username"]);
    return reply.send({status: "success", message: lines});
});

fastify.get("/api/v1/mod/restore/:vm", { schema: { querystring: mod_api_schema } },  async (request, reply) => {
    if(request.query["token"] != token) return reply.code(401).send({status: "error", message: "Unauthorized. Provide a valid token."});
    const vm = vms.find(vm => vm.options.vmName == request.params["vm"]);
    if(vm === undefined) {
        reply.code(404);
        return reply.send({status: "error", message: "VM does not exist."});
    }else if(!vm.connected) {
        reply.code(503);
        return reply.send({status: "error", message: `Not connected to ${request.params["vm"].toUpperCase()}. Try again later.`});
    }

    var result = await vm.Restore();
    if(result) {
        return reply.send({status: "success", message: `Successfully restored ${request.params["vm"].toUpperCase()}.`});
    }
});

fastify.get("/api/v1/mod/reboot/:vm", { schema: { querystring: mod_api_schema } },  async (request, reply) => {
    if(request.query["token"] != token) return reply.code(401).send({status: "error", message: "Unauthorized. Provide a valid token."});
    const vm = vms.find(vm => vm.options.vmName == request.params["vm"]);
    if(vm === undefined) {
        reply.code(404);
        return reply.send({status: "error", message: "VM does not exist."});
    }else if(!vm.connected) {
        reply.code(503);
        return reply.send({status: "error", message: `Not connected to ${request.params["vm"].toUpperCase()}. Try again later.`});
    }

    var result = await vm.Reboot();
    if(result) {
        return reply.send({status: "success", message: `Successfully rebooted ${request.params["vm"].toUpperCase()}.`});
    }
});

fastify.get("/api/v1/mod/ban/:vm/:username", { schema: { querystring: mod_api_schema } },  async (request, reply) => {
    if(request.query["token"] != token) return reply.code(401).send({status: "error", message: "Unauthorized. Provide a valid token."});
    const vm = vms.find(vm => vm.options.vmName == request.params["vm"]);
    if(vm === undefined) {
        reply.code(404);
        return reply.send({status: "error", message: "VM does not exist."});
    }else if(!vm.connected) {
        reply.code(503);
        return reply.send({status: "error", message: `Not connected to ${request.params["vm"].toUpperCase()}. Try again later.`});
    }

    const user = vm.users.some(user => user.username === request.params["username"]);
    if(!user) {
        return reply.send({status: "error", message: `User ${request.params["username"]} not found on ${request.params["vm"].toUpperCase()}.`});
    }

    var result = await vm.Ban(request.params["username"]);
    if(result) {
        return reply.send({status: "success", message: `Successfully banned ${request.params["username"]} from ${request.params["vm"].toUpperCase()}.`});
    }
});

fastify.get("/api/v1/mod/kick/:vm/:username", { schema: { querystring: mod_api_schema } }, async (request, reply) => {
    if(request.query["token"] != token) return reply.code(401).send({status: "error", message: "Unauthorized. Provide a valid token."});
    const vm = vms.find(vm => vm.options.vmName == request.params["vm"]);
    if(vm === undefined) {
        reply.code(404);
        return reply.send({status: "error", message: "VM does not exist."});
    }else if(!vm.connected) {
        reply.code(503);
        return reply.send({status: "error", message: `Not connected to ${request.params["vm"].toUpperCase()}. Try again later.`});
    }

    const user = vm.users.some(user => user.username === request.params["username"]);
    if(!user) {
        return reply.send({status: "error", message: `User ${request.params["username"]} not found on ${request.params["vm"].toUpperCase()}.`});
    }

    var result = await vm.Kick(request.params["username"]);
    if(result) {
        return reply.send({status: "success", message: `Successfully kicked ${request.params["username"]} from ${request.params["vm"].toUpperCase()}.`});
    }
});

fastify.get("/api/v1/mod/getip/:username", { schema: { querystring: mod_api_schema } }, async (request, reply) => {
    if(request.query["token"] != token) return reply.code(401).send({status: "error", message: "Unauthorized. Provide a valid token."});
    let foundAt: VM[] = [];
    vms.forEach(vm => {
        if(vm.users.some(user => user.username === request.params["username"])) {
            foundAt.push(vm);
        }
    });

    if(foundAt.length === 0) {
        reply.code(404);
        return reply.send({status: "error", message: `${request.params["username"]} not found on any VM.`});
    }

    let ips = [];
    for(const vm of foundAt) {
        var result = await vm.copyIP(request.params["username"]);
        if(typeof(result) === "string") {
            ips.push({
                vm: vm.options.vmName,
                ip: result
            });
        }
    }

    ips.sort((a, b) => a.vm.localeCompare(b.vm));

    return reply.send({status: "success", message: ips });
});

async function start(vmurl: string, vmname: string, pass:string, passIsToken: boolean = false) {

    let vm = new VM(vmurl, new ConnectionOptions({
        autologin: autologin,
        password: passIsToken ? null : pass,
        token: passIsToken ? pass : null,
        botName: botname,
        vmName: vmname
    }));

    vm.registerCustomHandler("chat", async (args: string[]) => {
        if(args.length == 3 && args[1] != '') {
            insert_message.run(args[1], HTMLDecode(args[2]), vm.options.vmName);
            let user = vm.users.find(x => x.username === args[1]);
            console.log(vm.options.vmName)
            console.log(vm.users)
            console.log(args);
            let res = autoMod.evaluate(user, HTMLDecode(args[2]), vm);
            if(res.size > 0) {
                let announce = {
                    description: null,
                    user: user.username,
                    message: HTMLDecode(args[2]),
                    ip: await vm.copyIP(user.username),
                    action: null,
		    vm: vm.options.vmName
                };

                let descriptions = [];

                res.forEach((action, description) => {
                    descriptions.push(description);
                    announce.action = action;
                });

                announce.description = descriptions.join("\n");

                autoMod.emitter.emit("event", announce);
            }
        }
    });

    vm.registerCustomHandler("adduser", async (args: string[]) => {
        var ip = await vm.copyIP(args[2]);
        if(ip && ip !== null) {
            const exists = db.prepare("SELECT * FROM userlogs WHERE username = ? AND ip = ? AND date >= datetime('now','-24 hour') AND vm = ?").get(args[2], ip as string, vm.options.vmName);
            if(typeof exists === "undefined") {
                insert_user.run(args[2], ip as string, vm.options.vmName);
            }
        }
    });

   vm.registerCustomHandler("rename", async (args: string[]) => {
	if(args[1] == "1" && args.length == 5) {
	    let user = vm.users.find(x => x.username === args[3]);
            let res = autoMod.evaluate(user, "", vm);
            if(res.size > 0) {
                let announce = {
                    description: null,
                    user: user.username,
                    message: "(no message, username was flagged)",
                    ip: await vm.copyIP(user.username),
                    action: null,
                    vm: vm.options.vmName
                };

                let descriptions = [];

                res.forEach((action, description) => {
                    descriptions.push(description);
                    announce.action = action;
                });

                announce.description = descriptions.join("\n");

                autoMod.emitter.emit("event", announce);
            }
}
   });

    await vm.connect().catch(err => {
        console.log(err);
    });

    vms.push(vm);
}

start("https://computernewb.com/collab-vm/vm0", "vm0b0t", "test");
start("https://computernewb.com/collab-vm/vm1", "vm1", "test");
start("https://computernewb.com/collab-vm/vm2", "vm2", "test");
start("https://computernewb.com/collab-vm/vm3", "vm3", "test");
start("https://computernewb.com/collab-vm/vm4", "vm4", "test");
start("https://computernewb.com/collab-vm/vm5", "vm5", "test");
start("https://computernewb.com/collab-vm/vm6", "vm6", "test");
start("https://computernewb.com/collab-vm/vm7", "vm7", "test");
start("https://computernewb.com/collab-vm/vm8", "vm8", "test");
start("https://computernewb.com/collab-vm/vm9", "vm9", "test", true);

autoMod.emitter.on('event', e => {
    eventConnections.forEach(x => x.socket.send(JSON.stringify(e)));
});

fastify.setErrorHandler((error, _, reply) => {
    reply.status(503).send({ status: "error", message: error.message });
});

fastify.setNotFoundHandler((_, res) => {
    res.status(404).send({ status: "error", message: "No such endpoint." });
});

fastify.listen({ host: "127.0.0.1", port: 9876 }, (err, address) => {
    if (err) throw err;
    console.log(`[specializedegg/fastify] Server is now listening on ${address}`);
});
