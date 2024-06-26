import { Canvas, CanvasRenderingContext2D, Image, createCanvas } from "canvas";
import WebSocket from "ws";
import { ConnectionOptions } from "./ConnectionOptions.js";
import { Rank } from "./Constants.js";
import { Decode, Encode } from "./Guacamole.js";
import { User } from "./User.js";
import { VoteInfo } from "./VoteInfo.js";
import { EventEmitter } from "events";
import { CollabVMProtocolMessage, CollabVMProtocolMessageType } from "./collab-vm-1.2-binary-protocol/src/index.js";
import * as msgpack from "msgpackr";

const capabilities = [ "bin" ];

export class VM extends EventEmitter {
    websocket: WebSocket;

    users: User[] = [];

    turnQueue: User[] = [];

    voteInfo: VoteInfo = new VoteInfo();

    display: Canvas = new Canvas(0, 0);
    displayCtx: CanvasRenderingContext2D = this.display.getContext("2d");

    customHandlers: Map<string, Function[]> = new Map<string, Function[]>();;

    url: string;
    options: ConnectionOptions;

    connected: boolean = false;

    private nopTimer: NodeJS.Timeout;
    private nopReceived: number = 0;
    private reconnectTime: number = 1000;
    private reconnecting: boolean = false;
    private disconnecting: boolean = false;
    private reconnectionAttempts: number = 0;
    private copiedIPs: Map<string, string> = new Map<string, string>;
    private builtinHandlers: Map<string, Function> = new Map<string, Function>();

    constructor(url: string, options: ConnectionOptions) {
        super();
        this.url = url;
        this.options = options;

        // Register default handlers
        this.builtinHandlers.set("nop", () => {
            this.websocket.send("3.nop;");
        });

        this.builtinHandlers.set("vote", (instr: string[]) => {
            if (instr[1] === '1') {
                this.voteInfo.time = parseInt(instr[2]);
                this.voteInfo.yes = parseInt(instr[3]);
                this.voteInfo.no = parseInt(instr[4]);
            } else if (instr[1] === '2') {
                this.voteInfo.time = 0;
                this.voteInfo.yes = 0;
                this.voteInfo.no = 0;
            }
        });

        this.builtinHandlers.set("admin", (instr: string[]) => {
            if (instr[1] === '19') {
                this.copiedIPs.set(instr[2], instr[3]);
            }
        });

        this.builtinHandlers.set("turn", (instr: string[]) => {
            let length = parseInt(instr[2]);
            if (length > 0) {
                this.turnQueue = [];
                let queue = instr.splice(3, instr.length);
                queue.forEach(_user => {
                    let user = this.users.find(user => user.username === _user);
                    this.turnQueue.push(user);
                });
            } else {
                this.turnQueue = [];
            }
        });

        this.builtinHandlers.set("connect", (instr: string[]) => {
            if (instr[1] === '1') {
                if (options.autologin) {
                    if (options.token) {
                        this.websocket.send(Encode("login", options.token));
                    }else if (options.password) {
                        this.websocket.send(Encode("admin", "2", options.password));
                    }
                    this.emit("connectedToNode");
                }
                this.connected = true;
                return false;
            }
        });

        if (options.token) {
            this.builtinHandlers.set("login", (instr: string[]) => {
                if (instr[1] != '1') {
                    throw new Error(`Failed to login to ${this.options.vmName}, check your token.`);
                }

                return false;
            });
        }

        this.builtinHandlers.set("adduser", (instr: string[]) => {
            if (parseInt(instr[1]) > 1) {
                // user list
                instr.splice(0, 2);
                for (let i = 0; i < instr.length; i += 2) {
			this.addOrEditUser(instr[i], instr[i + 1]);
                }
            } else {
                // single user
		if(instr.length === 4) {
                  this.addOrEditUser(instr[2], instr[3]);
		}
            }
        });

        this.builtinHandlers.set("rename", (instr: string[]) => {
            if (instr[1] === '1' && instr.length === 5) {
                this.renameUserReference(instr[2], instr[3]);
            }
        });

        this.builtinHandlers.set("remuser", (instr: string[]) => {
            this.users = this.users.filter(user => user.username !== instr[2]);
        });

        this.builtinHandlers.set("size", (instr: string[]) => {
            if (instr[1] === '0') {
                var _oldDisplay = null;
                if (this.display.width != 0 && this.display.height != 0) {
                    _oldDisplay = createCanvas(0, 0);
                    _oldDisplay.width = this.display.width;
                    _oldDisplay.height = this.display.height;
                    const _oldDisplayContext = _oldDisplay.getContext("2d");
                    _oldDisplayContext.drawImage(this.display, 0, 0, this.display.width, this.display.height, 0, 0, this.display.width, this.display.height);
                }

                this.display.width = parseInt(instr[2]);
                this.display.height = parseInt(instr[3]);
                if (_oldDisplay) {
                    this.displayCtx.drawImage(_oldDisplay, 0, 0, this.display.width, this.display.height, 0, 0, this.display.width, this.display.height);
                }
            }
        });

        this.builtinHandlers.set("png", (instr: string[]) => {
            if (instr[2] === '0') {
                const img = new Image();
                img.onload = () => {
                    this.displayCtx.drawImage(img, parseInt(instr[3]), parseInt(instr[4]));
                    this.emit('rect', img);
                }
                img.src = `data:image/jpeg;base64,${instr[5]}`;
            }
        });
    }

    private renameUserReference(oldName: string, newName: string) {
        let user = this.users.find(user => user.username == oldName);
        if (user !== undefined) {
            user.username = newName;
        }
    }

    private addOrEditUser(name: string, rank: string) {
        let _rank = Object.entries(Rank).find(_rank => _rank[1] === parseInt(rank))[1] as Rank;
        let user = this.users.find(user => user.username == name);
        if (user === undefined) {
            this.users.push(new User(name, _rank));
        } else {
            user.rank = _rank;
        }
    }

    public async registerCustomHandler(instructionName: string, callback: Function): Promise<boolean> {
        return new Promise((resolve, reject) => {
            let handler = this.customHandlers.get(instructionName);
            if (handler !== undefined) {
                if (!handler.includes(callback)) {
                    handler.push(callback);
                } else {
                    reject(`Function is already registered as a handler for "${instructionName}".`);
                }
            } else {
                this.customHandlers.set(instructionName, [callback]);
            }

            resolve(true);
        });
    }

    public async removeCustomHandler(instructionName: string, callback: Function): Promise<boolean> {
        return new Promise((resolve, reject) => {
            let handler = this.customHandlers.get(instructionName);
            if (handler !== undefined) {
                if (!handler.includes(callback)) {
                    handler.push(callback);
                } else {
                    reject(`Function is already registered as a handler for "${instructionName}".`);
                }
            } else {
                reject(`No instruction handlers found for ${instructionName}.`);
            }

            resolve(true);
        });
    }

    private async reconnect(): Promise<boolean> {
        return new Promise((resolve, _) => {
            setTimeout(async () => {
                this.websocket = null;
                if (await this.connect().catch(() => {
                    this.reconnectTime += 2000;
                    this.reconnectionAttempts++;
                    if (this.reconnectionAttempts >= this.options.maxReconnectionAttempts) {
                        console.warn(`[libcvmts/websocket] Maximum number of reconnection attempts exceeded for ${this.options.vmName}, giving up.`);
                        resolve(false);
                    } else {
                        console.warn(`[libcvmts/websocket] Failed to reconnect to ${this.options.vmName}, trying again in ${this.reconnectTime / 1000} seconds...`);
                        this.reconnect();
                    }
                })) {
                    console.log(`[libcvmts/websocket] Reconnected to ${this.options.vmName} successfully.`);
                    this.reconnectionAttempts = 0;
                    this.reconnecting = false;
                    resolve(true);

                };
            }, this.reconnectTime);
        });
    };

    public async disconnect(): Promise<boolean> {
        this.disconnecting = true;
        this.websocket.close();
        return new Promise((resolve, _) => {
            let timer = setInterval(() => {
                if (this.websocket.readyState == 3) {
                    clearInterval(timer)
                    console.log(`[libcvmts/websocket] Disconnected from ${this.options.vmName}.`);
                    resolve(true);
                }
            }, 10);
        });
    }

    public async SendChat(msg : string): Promise<boolean> {
        if (!this.connected) return false;
        this.websocket.send(Encode("chat", msg));
        return true;
    }

    public async Restore(): Promise<boolean> {
        if (!this.connected) return false;
        this.websocket.send(Encode("admin", "8", this.options.vmName));
        return true;
    }

    public async Reboot(): Promise<boolean> {
        if (!this.connected) return false;
        this.websocket.send(Encode("admin", "10", this.options.vmName));
        return true;
    }

    public async Kick(username: string): Promise<boolean> {
        if (!this.users.some(user => user.username === username)) return false;
        this.websocket.send(Encode("admin", "15", username));
        return true;
    }

    public async Ban(username: string): Promise<boolean> {
        if (!this.users.some(user => user.username === username)) return false;
        this.websocket.send(Encode("admin", "12", username));
        return true;
    }

    public async Mute(username: string, temporary: boolean = false): Promise<boolean> {
        if (!this.users.some(user => user.username === username)) return false;
        this.websocket.send(Encode("admin", "14", username, temporary ? "0" : "1"));
        return true;
    }

    public async Unmute(username: string): Promise<boolean> {
        if (!this.users.some(user => user.username === username)) return false;
        this.websocket.send(Encode("admin", "14", username, "2"));
        return true;
    }

    public async copyIP(username: string): Promise<string | boolean> {
        let promise: Promise<string | boolean> = new Promise((resolve, _) => {
            let done: boolean = false;
            if (!this.users.some(user => user.username === username)) {
                done = true;
                resolve(false)
            } else {
                this.websocket.send(Encode("admin", "19", username));

                let timer = setInterval(() => {
                    if (this.copiedIPs.has(username)) {
                        clearInterval(timer);
                        done = true;
                        var ip = this.copiedIPs.get(username);
                        this.copiedIPs.delete(username);
                        resolve(ip);
                    }
                }, 100);

                setTimeout(() => {
                    clearInterval(timer);
                    if (!done) {
                        resolve(null);
                    }
                }, 30000);
            }
        });

        return promise;
    };

    public getScreenshot(): Buffer {
        return this.display.toBuffer("image/jpeg");
    }

    public async connect(): Promise<VM> {
        if(this.options.password && this.options.token) {
            throw new Error("Both token and password are set, you must only set one of them depending on which authentication method you want to use.");
        }

	    let url = new URL(this.url)
        let headers = this.options.customHeaders;
        if (!headers["Origin"]) headers["Origin"] = `https://computernewb.com`;
        if (!headers["Host"]) headers["Host"] = url.hostname;
        if (!headers["User-Agent"]) headers["User-Agent"] = 'LibCVM.ts/0.0.2 (https://github.com/MDMCK10/libcvm.ts)';
        this.websocket = new WebSocket(this.url, "guacamole", {
            headers
        });

        this.websocket.on('open', () => {
            this.nopReceived = Date.now();
            this.websocket.on('close', () => {
                this.users = [];
                this.connected = false;
                if (!this.reconnecting && !this.disconnecting) {
                    console.warn(`[libcvmts/websocket] Connection to ${this.options.vmName} lost, reconnecting...`);
                    this.reconnecting = true;
                    this.reconnect();
                }
            });

            this.nopTimer = setInterval(() => {
                if (Date.now() - this.nopReceived > 10000) {
                    console.log(`[libcvmts/websocket] No messages received from ${this.options.vmName} in 10 seconds, disconnecting.`);
                    this.websocket.close();
                    clearInterval(this.nopTimer);
                }
            }, 1000);

            this.websocket.send(Encode("rename", this.options.botName));
            if (capabilities.length > 0) this.websocket.send(Encode("cap", ...capabilities));
            this.websocket.send(Encode("connect", this.options.vmName));
        });

        this.websocket.on('message', (data, isBinary) => {
            if (isBinary) this.handleBinaryMsg(data as Buffer);
            else this.handleTextMsg(data.toString());
        });

        this.websocket.on('error', (err) => {
            console.log(`[libcvmts/websocket] Error: ${err.message} while trying to connect to ${this.options.vmName}.`);
        });

        this.websocket.on('close', () => {
            this.emit("disconnected");
        });

        return new Promise((resolve, _) => {
            let timer = setInterval(() => {
                if (this.websocket.readyState === 1) {
                    clearInterval(timer)
                    if (!this.reconnecting) {
                        console.log(`[libcvmts/websocket] Connected to ${this.options.vmName} successfully.`);
                    }
                    resolve(this);
                } else if (this.websocket.readyState == 3) {
                    clearInterval(timer);
                    this.reconnect();
                }
            }, 10);
        });
    }

    private handleBinaryMsg(data: Buffer) {
        let msg: CollabVMProtocolMessage;
        try {
            msg = msgpack.decode(data);
        } catch (e) {
            console.log(`[libcvmts/binproto] Error: ${(e as Error).message} while trying to decode binary message.`);
            return;
        }
        if (msg.type === undefined) return;
        switch (msg.type) {
            case CollabVMProtocolMessageType.rect: {
                if (!msg.rect || msg.rect.x === undefined || msg.rect.y === undefined || msg.rect.data === undefined) return;
                let img = new Image();
                img.onload = () => {
                    this.displayCtx.drawImage(img, msg.rect.x, msg.rect.y)
                    this.emit('rect', img);
                };
                img.src = Buffer.from(msg.rect.data);
                break;
            }
        }
    }

    private handleTextMsg(data: string) {
        this.nopReceived = Date.now();
        let content = Decode(data);
        let defaultHandler = this.builtinHandlers.get(content[0]);
        if (defaultHandler !== undefined) {
            if (defaultHandler.call(this, content) === false) {
                return;
            };
        }

        let customHandlers = this.customHandlers.get(content[0]);
        if (customHandlers !== undefined) {
            customHandlers.forEach(handler => {
                if (handler.call(this, content) === false) {
                    return;
                }
            });
        }
    }
};
