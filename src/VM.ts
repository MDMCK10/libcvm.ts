import { Canvas, CanvasRenderingContext2D, Image, createCanvas } from "canvas";
import WebSocket from "ws";
import { ConnectionOptions } from "./ConnectionOptions";
import { DefaultHeaders, Rank } from "./Constants";
import { Decode, Encode } from "./Guacamole";
import { User } from "./User";
import { VoteInfo } from "./VoteInfo";

export class VM {
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
        this.url = url;
        this.options = options;

        // Register default handlers
        this.builtinHandlers.set("nop", () => {
            this.websocket.send("3.nop;");
            this.nopReceived = Date.now();
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
                    this.websocket.send(Encode("admin", "2", options.password));
                }
                this.connected = true;
                this.nopTimer = setInterval(() => {
                    if (this.nopReceived - Date.now() > 10000) {
                        console.log(`[libcvmts/websocket] No pings received from ${this.options.vmName} in 10 seconds, disconnecting.`);
                        this.disconnect();
                    }
                }, 10000);
                return false;
            }
        });

        this.builtinHandlers.set("adduser", (instr: string[]) => {
            if (parseInt(instr[1]) > 1) {
                // user list
                instr.splice(0, 2);
                for (let i = 0; i < instr.length; i += 2) {
                    this.addOrEditUser(instr[i], instr[i + 1]);
                }
            } else {
                // single user
                this.addOrEditUser(instr[2], instr[3]);
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
                img.onload = () => this.displayCtx.drawImage(img, parseInt(instr[3]), parseInt(instr[4]));
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
        clearInterval(this.nopTimer);
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

    public async connect(): Promise<VM> {
        this.websocket = new WebSocket(this.url, "guacamole", {
            headers: DefaultHeaders
        });

        this.websocket.onopen = () => {
            this.websocket.onclose = () => {
                this.users = [];
                this.connected = false;
                if (!this.reconnecting && !this.disconnecting) {
                    console.warn(`[libcvmts/websocket] Connection to ${this.options.vmName} lost, reconnecting...`);
                    this.reconnecting = true;
                    this.reconnect();
                }
            };

            this.websocket.send(Encode("rename", this.options.botName));
            this.websocket.send(Encode("connect", this.options.vmName));
        };

        this.websocket.onmessage = (ev) => {
            let content = Decode(ev.data.toString());
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
        };

        this.websocket.onerror = (err) => {
            console.log(`[libcvmts/websocket] Error: ${err.message}.`);
        };

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
};
