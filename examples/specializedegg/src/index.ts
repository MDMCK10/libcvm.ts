import { ConnectionOptions, VM } from "../../libcvmts/dist/index";
import { Encode } from "../../libcvmts/dist/Guacamole";
import Database from 'better-sqlite3';
import Fastify from 'fastify';

/* config */
const botname = "libcvmts";
const token = "hunter2";
const autologin = true;
/* end config */

const db = new Database('logs.db');
db.pragma('journal_mode = WAL');
db.exec("CREATE TABLE IF NOT EXISTS chatlogs (username CHAR, message CHAR, timestamp TEXT, vm CHAR)");
db.exec("CREATE TABLE IF NOT EXISTS userlogs (username CHAR, ip CHAR, date TEXT, vm CHAR)");
db.function('regexp', { deterministic: true }, (regex: string, text: string) => {
    return new RegExp(regex).test(text) ? 1 : 0;
});

const insert_message = db.prepare(`INSERT INTO chatlogs(username, message, timestamp, vm) VALUES(?, ?, datetime('now'), ?)`);
const insert_user = db.prepare(`INSERT INTO userlogs(username, ip, date, vm) VALUES(?, ?, datetime('now'), ?)`);
const chatlog_query_default = db.prepare(`SELECT * FROM chatlogs ORDER BY timestamp DESC LIMIT 10`);
const fastify = Fastify();
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

function HTMLDecode(input : string) : string {
    return input.replace(/&lt;/g, "<")
                .replace(/&gt;/g, ">")
                .replace(/&amp;/g, "&")
                .replace(/&quot;/g, "\"")
                .replace(/&#x27;/g, "'")
                .replace(/&#x2F;/g, "/")
                .replace(/&#13;&#10;/g, "\n");
}

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
    if(Object.keys(request.query).length === 0) {
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

async function start(vmurl: string, vmname: string) {

    let vm = new VM(vmurl, new ConnectionOptions({
        autologin: autologin,
        password: token,
        botName: botname,
        vmName: vmname
    }));

    vm.registerCustomHandler("chat", (args: string[]) => {
        if(args.length == 3 && args[1] != '') {
            insert_message.run(args[1], HTMLDecode(args[2]), vm.options.vmName);
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

    await vm.connect().catch(err => {
        console.log(err);
    });

    vms.push(vm);
}

start("https://computernewb.com/collab-vm/vm0", "vm0b0t");
start("https://computernewb.com/collab-vm/vm1", "vm1");
start("https://computernewb.com/collab-vm/vm2", "vm2");
start("https://computernewb.com/collab-vm/vm3", "vm3");
start("https://computernewb.com/collab-vm/vm4", "vm4");
start("https://computernewb.com/collab-vm/vm5", "vm5");
start("https://computernewb.com/collab-vm/vm6", "vm6");
start("https://computernewb.com/collab-vm/vm7", "vm7");
start("https://computernewb.com/collab-vm/vm8", "vm8");

fastify.setErrorHandler((error, _, reply) => {
    reply.status(503).send({ status: "error", message: error.message });
});

fastify.setNotFoundHandler((_, res) => {
    res.status(404).send({ status: "error", message: "No such endpoint." });
});

fastify.listen({ host: "127.0.0.1", port: 9876 }, (err, address) => {
    if (err) throw err;
    console.log(`[libcvmts_test/fastify] Server is now listening on ${address}`);
});
